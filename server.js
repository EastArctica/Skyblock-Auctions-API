const MongoClient = require('mongodb').MongoClient
const fs = require('fs')
const express = require('express')
const cors = require('cors')
const app = express()
app.use(cors())
const config = require('./config.json')
const timeStarted = Date.now()
const logFile = `logs/log-${timeStarted}.log`

let db
let skyblock
app.get('/', (req, res) => {
    res.send('Hypixel Skyblock custom API, contact East_Arctica#7667 for more details')
    let clientIP = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress
    console.log(`Request to / inbound from ${clientIP}`)
})

app.get('/auctions/', async (req, res) => {
    if (!db || !db.isConnected()) await connectToDB()
    let clientIP = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress
    res.setHeader('Content-Type', 'application/json')
    query = req.query.query || '{}'
    page = req.query.page || 0
    sort = req.query.sort || '{}'

    try {
        query = JSON.parse(query)
        sort = JSON.parse(sort)
        log(clientIP, req.originalUrl, 'Valid JSON')
    } catch (e) {
        log(clientIP, req.originalUrl, 'Invalid JSON')
        return res.json({ error: 'Invalid JSON query provided.' })
    }

    let auctionsCollection = skyblock.collection('auctions')

    let skipSize = page * config.pageSize
    auctionsCollection.find(query, { allowDiskUse: true }).sort(sort).skip(skipSize).limit(req.query.page === undefined ? 100000000000000 : config.pageSize).toArray(async (err, found) => {
        if (err) return res.json({ error: err })
        log(clientIP, req.originalUrl)
        res.json(found)
    })
})

app.listen(config.port, async () => {
    connectToDB()
    console.log(`Started Skyblock API at http://localhost:${config.port}`)
})

async function connectToDB() {
    console.log('Connecting to db...')
    MongoClient.connect(
        config.mongoSRV,
        { useNewUrlParser: true, useUnifiedTopology: true },
        (err, DB) => {
            if (err) return connectToDB()
            db = DB
            skyblock = DB.db('skyblock')
        }
    )

    while (typeof db == 'undefined') {
        await new Promise((resolve) => setTimeout(resolve, 10))
    }

    if (!db.isConnected()) {
        console.log('Something weird happened... re-starting db connection')
        return connectToDB()
    }
    appendLog('Database Connect')
    console.log('Successful connection to database')
    return db
}

async function log(IP, path, other) {
    if (!(await fs.exists('logs/', () => { }))) await fs.mkdir('logs', () => { })
    let time =
        new Date().toDateString() + ' ' + new Date().toTimeString().slice(0, 8)
    return appendLog(`${IP || '0.0.0.0'} | ${time || 0} | ${path || ''} | ${other || ''}`)
}

async function appendLog(log) {
    return fs.appendFile(logFile, decodeURI(log + '\n'), () => { })
}