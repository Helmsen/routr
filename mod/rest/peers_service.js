/**
 * @author Pedro Sanders
 * @since v1
 */
import isEmpty from 'utils/obj_util'
import parameterAuthFilter from 'rest/parameter_auth_filter'

const get = Packages.spark.Spark.get
const post = Packages.spark.Spark.post
const put = Packages.spark.Spark.put
const del = Packages.spark.Spark.delete
const before = Packages.spark.Spark.before

export default class PeersService {

    constructor(peersAPI, salt) {
        this.peersAPI = peersAPI
        this.salt = salt
    }

    attachEndpoints() {
        before("/peers", (req, res) => parameterAuthFilter(req, res, this.salt))
        before("/peers/*", (req, res) => parameterAuthFilter(req, res, this.salt))

        post('/peers', (req, res) => {
            const jsonObj = JSON.parse(req.body())
            let response = this.peersAPI.createFromJSON(jsonObj)
            return JSON.stringify(response)
        })

        get('/peers', (req, res) => {
            let filter = ''
            if(!isEmpty(req.queryParams("filter"))) {
                filter = req.queryParams("filter")
            }
            const response = this.peersAPI.getPeers(filter)
            return JSON.stringify(response)
        })

        get('/peers/:ref', (req, res) => {
            return JSON.stringify(this.peersAPI.getPeer(req.params(":ref")))
        })

        put('/peers/:ref', (req, res) => {
            const jsonObj = JSON.parse(req.body())
            jsonObj.metadata.ref = req.params(":ref")
            return JSON.stringify(this.peersAPI.updateFromJSON(jsonObj))
        })

        del('/peers/:ref', (req, res) => {
            const ref = req.params(":ref")
            return JSON.stringify(this.peersAPI.deletePeer(ref))
        })
    }
}