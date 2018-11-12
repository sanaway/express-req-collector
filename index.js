let AsyncLock = require('async-lock');

let LOCKER = new AsyncLock();
const TAG = "express-req-collector";

class Collector{
    constructor(){
        this.cache = [];
        this.callback = undefined;
        this.timerId = undefined;
    }

    input(obj){
        return LOCKER.acquire(TAG, ()=>{
            this.cache.push(obj);
        })//.catch(error=>{});
    }

    setCallback(cb){
        this.callback = cb;
    }

    setInterval(interval){
        if (this.timerId){
            clearInterval(this.timerId);
        }
        this.timerId = setInterval(()=>{
            LOCKER.acquire(TAG, ()=>{
                let temp = [];
                this.cache.forEach(obj=>{temp.push(obj)});
                this.cache = [];
                return temp;
            }).then((arr)=>{
                if (!this.callback)
                    return;
                let type = {}.toString.call(this.callback);
                if (type === '[object Function]' || type === "[object AsyncFunction]")
                    this.callback(arr);
            });
        }, interval);
    }

    destroy(){
        if (this.timerId){
            clearInterval(this.timerId);
            this.timerId = undefined;
        }
        this.callback = undefined;
        LOCKER.acquire(TAG, ()=>{
            this.cache = [];
        });
    }
}


let static_instance = undefined;

module.exports = {
    init: (callback, interval)=>{
        if (static_instance)
            static_instance.destroy();
        static_instance = new Collector();
        static_instance.setInterval(interval);
        static_instance.setCallback(callback);
    },
    destroy:()=>{
        if (static_instance)
            static_instance.destroy();
        static_instance = undefined;
    },
    middleware: (req, res, next)=>{
        let split = req.url.split("?");
        res.collect_data = {
            method: req.method,
            url: split[0],
            query: split.length > 1 ? split[1] : "",
            ip: req.ip ? req.ip.split(':').pop() : "",
            timestamp: new Date().getTime()
        };
        res.once('finish', ()=>{
            if (!static_instance)
                return;
            if (!res.collect_data)
                return;
            let obj = res.collect_data;
            if (!obj)
                return;
            obj.responseTime = Number.isInteger(obj.timestamp) ? new Date().getTime() - obj.timestamp : 0;
            obj.statusCode = res.statusCode;
            obj.success = (Math.floor(res.statusCode / 100) === 2 || res.statusCode === 304) ? 1 : 0;
            if (static_instance)
                static_instance.input(obj).catch(console.error);
        });
        next();
    },
    exporter:{
        influx: require("./influx_exporter")
    }
}