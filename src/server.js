const MongoClient = require('mongodb').MongoClient
const fs = require('fs')
const express = require('express')
const cors = require('cors')
const app = express()
app.use(cors())
const config = require('../config.json')
const startDate = new Date()
const logFile = `logs/${startDate.getFullYear()}-${startDate.getMonth()}-${startDate.getDay()}_${startDate.getHours()}:${startDate.getMinutes()}.${startDate.getSeconds()}.log` // logs/2021-5-5_12:32.7.log

let lastUpdated = 0 // This should probs be different but 0 seems to be the best way for now... better than startDate at least?
let currentDB = 'main'
let db
let skyblock
app.get('/', (req, res) => {
    res.send('Hypixel Skyblock custom API. Join the discord <a href="https://discord.gg/TXEtRa4yve">here</a>')
    //let clientIP = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress
    //console.log(`Request to / inbound from ${clientIP}`)
})

app.get('/auctions/', async (req, res) => {
    let clientIP = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket.remoteAddress
    res.setHeader('Content-Type', 'application/json')
    query = req.query.query || req.query.q || '{}'
    page = req.query.page || req.query.p || 0
    sort = req.query.sort || req.query.s || '{}'

    try {
        query = JSON.parse(query)
        sort = JSON.parse(sort)
        log(clientIP, req.originalUrl, 'Valid JSON')
    } catch (e) {
        log(clientIP, req.originalUrl, 'Invalid JSON')
        return res.json({ error: 'Invalid JSON query provided.' })
    }

    let auctionsCollection = currentDB == 'main' ? skyblock.collection('auctionsMain') : skyblock.collection('auctionsCache')

    let skipSize = page * config.pageSize
    auctionsCollection.find(query, { allowDiskUse: true }).sort(sort).skip(skipSize).limit(req.query.page === undefined ? 9999999999999999 : config.pageSize).toArray(async (err, found) => {
        if (err) return res.json({ error: err })
        res.json(found)
    })
})

app.get('/auctions/swapDB/:db', (req, res) => {
    currentDB = req.params.db
    lastUpdated = Date.now()
    res.send('')
})

app.get('/auctions/lastUpdated/', (req, res) => {
    // Logging for this is probably a bad idea as alot of people may request it
    res.setHeader('Content-Type', 'application/json')
    res.json({
        lastUpdated: lastUpdated
    })
})

app.listen(config.port, async () => {
    console.log(`Started Skyblock API at http://localhost:${config.port}`)
})

async function log(IP, path, other) {
    if (!(await fs.exists('logs/', () => {}))) await fs.mkdir('logs', () => { })
    let time = new Date().toDateString() + ' ' + new Date().toTimeString().slice(0, 8)
    return appendLog(`${IP || '0.0.0.0'} | ${time || 0} | ${path || ''} | ${other || ''}`)
}

async function appendLog(log) {
    return fs.appendFile(logFile, decodeURI(log + '\n'), () => { })
}

MongoClient.connect(config.mongoSRV, { useNewUrlParser: true, useUnifiedTopology: true }, (err, DB) => {
    db = DB
    skyblock = DB.db('skyblock')
})