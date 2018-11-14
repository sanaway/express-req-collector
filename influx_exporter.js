let Influx = require("influx");
let AsyncLock = require('async-lock');


let LOCKER = new AsyncLock();
const TAG = "influx-exporter";

class InfluxWriter{
    constructor(uri, database, params){
        this.influx = new Influx.InfluxDB(uri);
        this.database = database;
        this.inited = -1;
        this.onlyCollectCount = false;
        if (params){
            if (typeof params.onlyCollectCount === 'boolean')
                this.onlyCollectCount = params.onlyCollectCount;
        }
    }

    init(){
        return LOCKER.acquire(TAG, async ()=>{
            if (this.inited === -1){
                try {
                    let alldb = await this.influx.getDatabaseNames();
                    if (!alldb.some(db=>{return db === this.database})){
                        await this.influx.createDatabase(this.database);
                    }
                    this.inited = 1;
                } catch(err){
                    this.inited = 0;
                    throw err;
                }
            }
        })
    };

    async writePoints(measurement, points){
        if (!measurement || !Array.isArray(points))
            return;
        if (this.inited < 0){
            await this.init();
        }
        if (this.init === 0){
            throw "DB init faild."
        }
        await this.influx.writeMeasurement(measurement, points, {database: this.database});
    }

    recordAllRequests(){
        return this.onlyCollectCount === false;
    }
}


module.exports = (params) => {
    if (!params.url){
        throw "missing url";
    }
    let port = params.port || 8086;
    if (params.user){
        if (!params.password)
            throw "missing password"
    }
    if (!params.database){
        throw "missing database";
    }
    let identity = params.user ? `${params.user}:${params.password}@` : ""
    let uri = `http://${identity}${params.url}:${port}`;
    let influx = new InfluxWriter(uri, params.database, params);
    return async (reqs)=>{
        if (!Array.isArray(reqs))
            return;
        let counter = {
            success: 0,
            faild: 0
        }
        let arr = reqs.map(req=>{
            if (!req.timestamp || !req.url || !req.method || !req.statusCode)
                return undefined;
            if (req.success !== undefined){
                if (req.success === 1)
                    counter.success++;
                else
                    counter.faild++;
            } else {
                if (Math.floor(req.statusCode/100) === 2 || req.statusCode ===304)
                    counter.success++;
                else   
                    counter.faild++;
            }
            let tags = {
                url: req.url,
                method: req.method,
            };
            if (typeof req.query === 'string' && req.query.length > 0)
                tags.query = req.query;

            return {
                timestamp: new Date(req.timestamp),
                tags: tags,
                fields:{
                    code: req.statusCode,
                    response_time: req.responseTime
                }
            }
        }).filter(req=>{return req !== undefined});
        arr = arr
        if (arr.length <= 0)
            return;
        await influx.writePoints("reliability", [{
            timestamp: new Date(),
            fields:{
                success: counter.success,
                total: counter.success + counter.faild
            }
        }]);
        if (influx.recordAllRequests()){
            await influx.writePoints("requests", arr);
        }
    }
}
/*
method
url
query
ip
timestamp
responseTime
statusCode
success

*/