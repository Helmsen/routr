/**
 * @author Pedro Sanders
 * @since v1
 */
const {
  sendResponse,
  sendUnauthorized
} = require('@routr/core/processor/processor_utils')
const RegisterHandler = require('@routr/core/processor/register_handler')
const RegistryHandler = require('@routr/core/processor/registry_handler')
const CancelHandler = require('@routr/core/processor/cancel_handler')
const RequestHandler = require('@routr/core/processor/request_handler')
const RouteInfo = require('@routr/core/processor/route_info')
const AclUtil = require('@routr/core/acl/acl_util')
const { RoutingType } = require('@routr/core/routing_type')
const { RouteEntityType } = require('@routr/core/route_entity_type')
const { Status } = require('@routr/core/status')
const config = require('@routr/core/config_util')()
const FromHeader = Java.type('javax.sip.header.FromHeader')
const SynthRegistrar = require('@routr/registrar/synth_reg')
const Registrar = require('@routr/registrar/registrar')

const Request = Java.type('javax.sip.message.Request')
const Response = Java.type('javax.sip.message.Response')
const LogManager = Java.type('org.apache.logging.log4j.LogManager')
const LOG = LogManager.getLogger()

const globalACL = config.spec.accessControlList

// Experimental feature
const isScaipMessage = r => r.getHeader(FromHeader.NAME).getTag() === '286524'

class RequestProcessor {
  constructor (sipProvider, dataAPIs, contextStorage) {
    this.sipProvider = sipProvider
    this.contextStorage = contextStorage
    this.dataAPIs = dataAPIs
    this.domainsAPI = dataAPIs.DomainsAPI
    this.synthRegistrar = new SynthRegistrar()
    this.registrar = new Registrar()
  }

  process (event) {
    const request = event.getRequest()
    let transaction = event.getServerTransaction()

    if (
      transaction === null &&
      request.getMethod().equals(Request.ACK) === false
    ) {
      transaction = this.sipProvider.getNewServerTransaction(request)
    }

    const routeInfo = new RouteInfo(request, this.dataAPIs)

    const callee = routeInfo.getCallee()
    if (
      callee &&
      callee.spec &&
      callee.spec.credentials &&
      callee.spec.credentials.secret
    ) {
      callee.spec.credentials.secret = '****'
    }
    LOG.debug(
      `core.processor.RequestProcessor.process [route type ${routeInfo.getRoutingType()}]`
    )
    LOG.debug(
      `core.processor.RequestProcessor.process [entity info ${JSON.stringify(
        callee
      )}]`
    )

    // Warning: This is a very expensive function. Consider making it optional
    // Or optimize
    if (this.allowedAccess(event, routeInfo) === false) {
      LOG.debug(
        `core.processor.RequestProcessor.process [access denied for ${JSON.stringify(
          callee
        )}]`
      )
      return sendResponse(transaction, Response.FORBIDDEN)
    }

    LOG.debug(
      `core.processor.RequestProcessor.process [running handler for method \`${request.getMethod()}\`]`
    )

    switch (request.getMethod()) {
      case Request.PUBLISH:
      case Request.NOTIFY:
      case Request.SUBSCRIBE:
        sendResponse(transaction, Response.METHOD_NOT_ALLOWED)
        break
      case Request.REGISTER:
        if (
          !routeInfo.isLocalDomain() &&
          routeInfo.getCallerType() === RouteEntityType.THRU_GW
        ) {
          new RegistryHandler(this.sipProvider).doProcess(transaction)
          break
        }
        new RegisterHandler().doProcess(transaction)
        break
      case Request.CANCEL:
        new CancelHandler().doProcess(transaction)
        break
      default:
        if (
          request.getMethod() === Request.MESSAGE &&
          isScaipMessage(request)
        ) {
          LOG.debug(
            `core.processor.RequestProcessor.process [detected scaip message]]`
          )
          // Check if message is authenticated
          if (config.spec.ex_scaipAuthEnabled) {
            LOG.debug(
              `core.processor.RequestProcessor.process [scaip auth provider = ${config.spec.ex_scaipAuthProvider.toLowerCase()}]`
            )
            let auth = false
            if (config.spec.ex_scaipAuthProvider.toLowerCase() === 'rest') {
              // No yet implemented
            } else {
              auth = this.registrar.isAuthorized(request)
            }

            LOG.debug(
              `core.processor.RequestProcessor.process [message authenticated ${auth}]`
            )

            if (!auth) {
              sendUnauthorized(transaction)
              // Prevent rejecting request with same CSeq
              // this.sipProvider.getSipStack().removeTransaction(transaction)
              break
            }
          }

          this.synthRegistrar.register(request)
        }
        new RequestHandler(this.sipProvider, this.contextStorage).doProcess(
          transaction,
          request,
          routeInfo
        )
    }
  }

  allowedAccess (event, routeInfo) {
    const request = event.getRequest()
    const remoteIp = event.getRemoteIpAddress()

    if (globalACL) {
      if (new AclUtil(globalACL).isIpAllowed(remoteIp) === false) {
        return false
      }
    }

    if (routeInfo.getRoutingType().equals(RoutingType.INTRA_DOMAIN_ROUTING)) {
      const addressOfRecord = request.getRequestURI()
      const response = this.domainsAPI.getDomainByUri(addressOfRecord.getHost())
      if (response.status === Status.OK) {
        const acl = response.data.spec.context.accessControlList
        if (acl) {
          return new AclUtil(acl).isIpAllowed(remoteIp)
        }
      }
    }
    return true
  }
}

module.exports = RequestProcessor
