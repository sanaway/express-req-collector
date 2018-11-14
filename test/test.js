let SuperTestRequest = require('supertest');
let express = require("express");
let bodyParser = require("body-parser");
let ReqCollector = require("../index");
let Influx = require("influx");

const INFLUX_URL = process.env.INFLUX_URL||"10.78.26.51";
const INFLUX_DATABASE = "test_db";

let static_app;


let localCache = undefined;

let shouldSuccess = 0;
let shouldFaild = 0;

function getExpressApp(){
    if (static_app)
        return static_app;
    static_app = express();
    static_app.use(bodyParser.urlencoded({ extended: true }));
    static_app.use(bodyParser.json());

    let exporter = (INFLUX_URL) ? 
        ReqCollector.exporter.influx({
            url: INFLUX_URL,
            database: INFLUX_DATABASE,
            onlyCollectCount:true
        }) : (reqs)=>{
            if (!localCache)
                localCache = reqs;
        };
    
    ReqCollector.init(exporter, 5000);
    ReqCollector.setFilterOutEndpoints(["echo"]);
    static_app.use(ReqCollector.middleware);
    static_app.get("/echo", (req, res)=>{
        res.status(204).send();
    })
    static_app.get("/test_get", (req, res)=>{
        res.status(200).send();
    })
    static_app.get("/test_get_faild", (req, res)=>{
        res.status(500).send();
    })
    static_app.post("/test_post", (req, res)=>{
        res.status(200).send();
    });
    static_app.use(function(req, res){
        res.status(404).send();
    });
    return static_app;
}

function getTestServer(){
    return SuperTestRequest(getExpressApp());
}

describe("emulate request: ", function() {
    let testService =  getTestServer();

    it(`GET /echo`, function(done){
        testService.get(`/echo`)
        .expect(204, done);
    });

    it(`GET /test_get`, function(done){
        shouldSuccess += 1;
        testService.get(`/test_get`)
        .expect(200, done);
    });
    it(`GET /test_get?abc=abc,xyz=xyz`, function(done){
        shouldSuccess += 1;
        testService.get(`/test_get?abc=abc,xyz=xyz`)
        .expect(200, done);
    });
    it(`GET /test_get_faild`, function(done){
        shouldFaild += 1;
        testService.get(`/test_get_faild`)
        .expect(500, done);
    });
    it(`POST /test_post`, function(done){
        shouldSuccess += 1;
        testService.post(`/test_post`)
        .expect(200, done);
    });

    it(`GET /notfound`, function(done){
        shouldFaild += 1;
        testService.get(`/notfound`)
        .expect(404, done);
    });

    it('Waiting 10s', function(done){
        this.timeout(0);
        new Promise((resolve, reject)=>{
            setTimeout(()=>{resolve()}, 10000)
        }).then(done);
    })
});



describe("validation : local cache", function() {
    before(function(){
        if (INFLUX_URL){
            this.skip();
        }
    })
    it('from memory', function(done){
        this.timeout(0);
        if (!Array.isArray(localCache)){
            done("nothing in memory")
            return;
        }
        let success = 0;
        let faild = 0;
        localCache.forEach(r=>{
            console.log(new Date(r.timestamp), `[${r.statusCode}][${r.method}]${r.url}${(r.query?`?${r.query}`:"")}`)
            if (r.success === 1)
                success++;
            else
                faild++;
        })
        console.log(`success(${success} / ${shouldSuccess}), faild(${faild} / ${shouldFaild})`);
        if (success === shouldSuccess && faild === shouldFaild)
            done();
        else
            done("something faild");
    })
})

describe("validation : influx exporter", function() {
    before(function(){
        if (!INFLUX_URL){
            this.skip();
        }
    })
    it(`query from influxdb`, function(done){
        this.timeout(0);
        let influx = new Influx.InfluxDB(`http://${INFLUX_URL}:8086`);
        influx.query(
            "select * from requests where time > now() - 15s order by time asc",
            {database: INFLUX_DATABASE}
        ).then((result)=>{
            result.forEach(r=>{
                console.log(new Date(r.time), `[${r.code}][${r.method}]${r.url}${(r.query?`?${r.query}`:"")}`)
            })
            return influx.query(
                "select * from reliability where time > now() - 15s",
                {database: INFLUX_DATABASE}
            )
        }).then((result)=>{
            if (result.length <= 0){
                return "nothing found in 'reliability' table";
            }
            let success = result[0].success;
            let faild = result[0].total - result[0].success;
            console.log(`success(${success} / ${shouldSuccess}), faild(${faild} / ${shouldFaild})`);
            if (success === shouldSuccess && faild === shouldFaild)
                return undefined;
            else
                return "something faild";
        }).then((err)=>{
            ReqCollector.destroy();
            done(err);
        })
    });
})

describe("Destroy", function() {
    it(`request collector`, function(done){
        this.timeout(0);
        ReqCollector.destroy();
        done();
    });
})