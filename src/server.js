const JSON5 = require('json5')
const MongoClient = require('mongodb').MongoClient
const fs = require('fs')
const morgan = require('morgan')
const express = require('express')
const cors = require('cors')

const app = express()
app.use(cors())
const config = require('../config.json')
const startDate = new Date()
const logFile = `logs/${startDate.getFullYear()}-${startDate.getMonth()+1}-${startDate.getDate()}_${startDate.getHours()}:${startDate.getMinutes()}.${startDate.getSeconds()}.log` // logs/2021-5-5_12:32.7.log
const redocFile = fs.readFileSync('static/redoc-static.html', 'utf-8')

let skyblockDB = null


/*
Format:
{
    "1.1.1.1": {
        "count": 1
    }
}
*/
let rateLimits = {}

setInterval(() => {
    rateLimits = {}
}, 1000 * 60) // 1 minute

class Environment {
    constructor(env, db) {
        this.env = env
        this.currentDB = db
        this.lastUpdated = 0
        this.totalAuctions = 0
    }
    getCollection() {
        return this.currentDB == 'main' ? skyblockDB.collection(this.env + '_auctionsMain') : skyblockDB.collection(this.env + '_auctionsCache')
    }
}

let environments = {
    prod: new Environment('prod', 'main'),
    dev: new Environment('dev', 'main'),
    staging: new Environment('staging', 'main')
}

const logStream = fs.createWriteStream(logFile, { flags: 'a' })
fs.unlinkSync('logs/latest.log')
const latestLogStream = fs.createWriteStream('logs/latest.log', { flags: 'a' })

morgan.token('remote-addr', (req, res) => { return req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '0.0.0.0' }) // remote-addr will be localhost because of nginx
app.use([ morgan('combined', { stream: logStream }), morgan('combined', { stream: latestLogStream }) ])

app.get('/', (req, res) => {
    res.send(redocFile)
})
let bannedReqs = 0;
app.get('/auctions/', async (req, res) => {
    res.setHeader('Content-Type', 'application/json')
    query = req.query.query || req.query.q || '{}'
    page = Number(req.query.page) || Number(req.query.p) || 0
    sort = req.query.sort || req.query.s || '{}'
    limit = Number(req.query.limit) || Number(req.query.l) || 9999999999999999
    filter = req.query.filter || req.query.f || '{}'

    rateLimits[req.headers['cf-connecting-ip']] = {
        count:  rateLimits[req.headers['cf-connecting-ip']] ? rateLimits[req.headers['cf-connecting-ip']].count + 1 : 1
    } 
    if (rateLimits[req.headers['cf-connecting-ip']] !== undefined && rateLimits[req.headers['cf-connecting-ip']].count > config.rateLimit) {
        console.log(`${req.headers['cf-connecting-ip']} is being rate limited ${rateLimits[req.headers['cf-connecting-ip']].count}`)
        return res.status(429).json({
            error: 'Rate limit reached'
        })
    }

    if ((req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '0.0.0.0') == '35.197.113.233') {
        console.log('Request from banned IP', bannedReqs++)
        return res.status(403).json({
            error: 'Bro what the fuck are you doing, stop sending hundreds of requests'
        })
    }

    if (req.query.aggregate) {
        let aggregate
        try {
            aggregate = JSON5.parse(req.query.aggregate)
        } catch(e) {
            res.status(400).send({ error: 'Invalid JSON provided.' })
            return
        }
        return environments.prod.getCollection().aggregate(aggregate).toArray().then((found) => {
            res.json(found)
        })
    }

    try {
        query = JSON5.parse(query)
        sort = JSON5.parse(sort)
        filter = JSON5.parse(filter)
        filter['_id'] = 0
    } catch (e) {
        return res.status(400).json({ error: 'Invalid JSON provided.' })
    }

    if (typeof(query) != 'object' || typeof(page) != 'number' || typeof(sort) != 'object' || typeof(limit) != 'number' || typeof(filter) != 'object') return res.status(400).json({ error: 'Invalid data type provided' })

    let skipSize = page * config.pageSize
    environments.prod.getCollection().find(query, { allowDiskUse: true }).sort(sort).skip(skipSize).limit(req.query.page === undefined ? limit : config.pageSize).project(filter).toArray(async (err, found) => {
        if (err) return res.status(500).json({ error: err })
        res.json(found)
    })
})

app.get('/skyblock/auctions/', async (req, res) => {
    res.setHeader('Content-Type', 'application/json')
    query = req.query.query || req.query.q || '{}'
    page = Number(req.query.page) || Number(req.query.p) || 0
    sort = req.query.sort || req.query.s || '{}'
    limit = Number(req.query.limit) || Number(req.query.l) || 9999999999999999
    filter = req.query.filter || req.query.f || '{}'

    rateLimits[req.headers['cf-connecting-ip']] = {
        count:  rateLimits[req.headers['cf-connecting-ip']] ? rateLimits[req.headers['cf-connecting-ip']].count + 1 : 1
    } 
    if (rateLimits[req.headers['cf-connecting-ip']] !== undefined && rateLimits[req.headers['cf-connecting-ip']].count > config.rateLimit) {
        console.log(`${req.headers['cf-connecting-ip']} is being rate limited ${rateLimits[req.headers['cf-connecting-ip']].count}`)
        return res.status(429).json({
            error: 'Rate limit reached'
        })
    }

    if ((req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '0.0.0.0') == '35.197.113.233') {
        console.log('Request from banned IP', bannedReqs++)
        return res.status(403).json('{ "error": "Bro what the fuck are you doing, stop sending hundreds of requests" }')
    }

    if (req.query.aggregate) {
        let aggregate
        try {
            aggregate = JSON5.parse(req.query.aggregate)
        } catch(e) {
            res.status(400).send({ error: 'Invalid JSON provided.' })
            return
        }
        return environments.prod.getCollection().aggregate(aggregate).toArray().then((found) => {
            res.json(found)
        })
    }

    try {
        query = JSON5.parse(query)
        sort = JSON5.parse(sort)
        filter = JSON5.parse(filter)
        filter['_id'] = 0
    } catch (e) {
        return res.status(400).json({ error: 'Invalid JSON provided.' })
    }

    if (typeof(query) != 'object' || typeof(page) != 'number' || typeof(sort) != 'object' || typeof(limit) != 'number' || typeof(filter) != 'object') return res.status(400).json({ error: 'Invalid data type provided' })

    let skipSize = page * config.pageSize
    environments.prod.getCollection().find(query, { allowDiskUse: true }).sort(sort).skip(skipSize).limit(req.query.page === undefined ? limit : config.pageSize).project(filter).toArray(async (err, found) => {
        if (err) return res.status(500).json({ error: err })
        res.json(found)
    })
})

app.get('/skyblock/auctions/info', (req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.json({
        lastUpdated: environments.prod.lastUpdated,
        totalAuctions: environments.prod.totalAuctions,
        currentDB: environments.prod.currentDB
    })
})

app.get('/skyblock/auctions/:env/', async (req, res) => {
    res.setHeader('Content-Type', 'application/json')
    query = req.query.query || req.query.q || '{}'
    page = Number(req.query.page) || Number(req.query.p) || 0
    sort = req.query.sort || req.query.s || '{}'
    limit = Number(req.query.limit) || Number(req.query.l) || 9999999999999999
    filter = req.query.filter || req.query.f || '{}'

    rateLimits[req.headers['cf-connecting-ip']] = {
        count:  rateLimits[req.headers['cf-connecting-ip']] ? rateLimits[req.headers['cf-connecting-ip']].count + 1 : 1
    } 
    if (rateLimits[req.headers['cf-connecting-ip']] !== undefined && rateLimits[req.headers['cf-connecting-ip']].count > config.rateLimit) {
        console.log(`${req.headers['cf-connecting-ip']} is being rate limited ${rateLimits[req.headers['cf-connecting-ip']].count}`)
        return res.status(429).json({
            error: 'Rate limit reached'
        })
    }

    if ((req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress || '0.0.0.0') == '35.197.113.233') {
        console.log('Request from banned IP', bannedReqs++)
        return res.status(403).json('{ "error": "Bro what the fuck are you doing, stop sending hundreds of requests" }')
    }

    if (req.query.aggregate) {
        let aggregate
        try {
            aggregate = JSON5.parse(req.query.aggregate)
        } catch(e) {
            res.status(400).send({ error: 'Invalid JSON provided.' })
            return
        }
        if (!environments[req.params.env]) return res.json({ error: 'Invalid environment provided.' })
        return environments[req.params.env].getCollection().aggregate(aggregate).toArray().then((found) => {
            res.json(found)
        })
    }

    try {
        query = JSON5.parse(query)
        sort = JSON5.parse(sort)
        filter = JSON5.parse(filter)
        filter['_id'] = 0
    } catch (e) {
        return res.status(400).json({ error: 'Invalid JSON provided.' })
    }

    let skipSize = page * config.pageSize
    if (!environments[req.params.env]) return res.json({ error: 'Invalid environment provided.' })
    environments[req.params.env].getCollection().find(query, { allowDiskUse: true }).sort(sort).skip(skipSize).limit(req.query.page === undefined ? limit : config.pageSize).project(filter).toArray(async (err, found) => {
        if (err) return res.status(500).json({ error: err })
        res.json(found)
    })
})

app.get('/skyblock/auctions/swapDB/:env/:db/', async (req, res) => {
    if (req.query.key !== 'ZFAzbAWZLh42oggnY72JTccdu32KCF') return res.status(404).send(`Cannot ${req.method} ${req.baseUrl + req.path}`)

    swapDatabase(req.params.env, req.params.db)
    res.send(`Swapped ${req.params.env} to ${req.params.db}`)
})

app.get('/skyblock/eastarcticatk/deprecationWarning/*', (req, res) => {
    res.status(400).json({
        error: 'This api is deprecated. Please use https://api.eastarcti.ca/skyblock/auctions/'
    })
})

app.listen(config.port, async () => {
    console.log(`Started Skyblock API at http://localhost:${config.port}`)
})

MongoClient.connect(config.mongoSRV_Read, { useNewUrlParser: true, useUnifiedTopology: true }, (err, DB) => {
    db = DB
    skyblockDB = DB.db('skyblock')
})

async function swapDatabase(environment, db) {
    let env = environments[environment]
    if (!env) return console.log('Invalid environment', environment, db);

    env.currentDB = db
    env.lastUpdated = Date.now()
    env.totalAuctions = await env.getCollection().countDocuments({})
}
