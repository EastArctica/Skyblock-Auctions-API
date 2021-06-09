const MongoClient = require('mongodb').MongoClient
const fs = require('fs')
const fetch = require('node-fetch')
const express = require('express')
const cors = require('cors')
const app = express()
app.use(cors())
const config = require('./config.json')

let timeStarted = Date.now()
let lastResetRateLimit = timeStarted
let db
let skyblock
let rateLimitObj = {}
app.get('/', (req, res) => {
    res.send('Hypixel Skyblock custom API, contact East_Arctica#7667 for more details')
    let clientIP = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.connection.remoteAddress
    console.log(`Request to / inbound from ${clientIP}`)
})

app.get('/auctions/', async (req, res) => {
    // Rate limit code:
    let clientIP = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.connection.remoteAddress
    console.log(`Request to /auctions/ inbound from ${clientIP} with query ${req.query.q}`)
    
    if (!config.whitelistedKeys.includes(req.query.apiKey)) {
        if (!rateLimitObj[clientIP]) {
            rateLimitObj[clientIP] = []
        }
        rateLimitObj[clientIP].push('')
        if (rateLimitObj[clientIP].length > config.rateLimit) {
            log('Rate Limit', [
                clientIP,
                rateLimitObj[clientIP].length,
                req.query.q
            ])
            return res.send(
                JSON.stringify({
                    error: 'Rate limit reached',
                    msLeft: lastResetRateLimit - Date.now() + 60000
                })
            )
        }
    }
    if (!db.isConnected()) await connectToDB()

    if (req.query.q) {
        // Let's make sure the query is valid first
        let searchQuery
        try {
            searchQuery = JSON.parse(decodeURI(req.query.q))
        } catch (e) {
            log('Invalid JSON', [clientIP, req.query.q])
            return res.send(JSON.stringify({
                error: 'Invalid JSON query provided.'
            }))
        }

        let auctionsCollection = skyblock.collection('auctions')
        auctionsCollection.find(searchQuery).toArray(async (err, found) => {
            if (err) return res.send({ error: err })
            res.send(JSON.stringify(found))
        })
    } else {
        // No query, send all of the auction house
        let auctionsCollection = skyblock.collection('auctions')
        auctionsCollection.find({}).toArray(async (err, found) => {
            if (err) res.send({ error: err })
            res.send(JSON.stringify(found))
        })
    }
})
app.get('/auctions/search/:query', async (req, res) => {
    // Rate limit code:
    let clientIP = req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.connection.remoteAddress
    console.log(`Request to /auctions/search/${req.params.query} inbound from ${clientIP}`)
    if (!db.isConnected()) await connectToDB()

    if (req.params.query) {
        if (req.params.query == '') {
            return res.send('{}')
        }

        let auctionsCollection = skyblock.collection('auctions')
        console.log(`{ item_name: {$regex : \`.*${req.query}.*\`}}`)
        auctionsCollection.find({ item_name: { $regex: `.*${req.params.query}.*` } }).limit(1000).toArray(async (err, found) => {
            if (err) return res.send({ error: err })
            res.send(JSON.stringify(found))
        })
    } else {
        return res.send('{}')
    }
})

app.listen(config.port, async () => {
    connectToDB(true)
    console.log(`Started Skyblock API at http://localhost:${config.port}`)
})

async function connectToDB(isFirstConnect) {
    console.log('Connecting to db...')
    MongoClient.connect(config.mongoSRV, { useNewUrlParser: true, useUnifiedTopology: true }, (err, DB) => {
        if (err) return connectToDB()
        db = DB
        skyblock = DB.db('skyblock')
    })

    while (typeof db == 'undefined') {
        await new Promise((resolve) => setTimeout(resolve, 10))
    }

    if (!db.isConnected()) {
        console.log('Something weird happened... re-starting db connection')
        return connectToDB()
    }
    log('Database Connect')
    console.log('Successful connection to database')
    if (isFirstConnect) startAHLoop()
    return db
}

setInterval(() => {
    rateLimitObj = {}
    lastResetRateLimit = Date.now()
}, 60000)

async function log(type, data) {
    if (!await fs.exists('logs/', () => { })) await fs.mkdir('logs', () => { })
    let time =
        new Date().toDateString() + ' ' + new Date().toTimeString().slice(0, 8)
    switch (type) {
        case 'Rate Limit':
            return fs.appendFile(
                `logs/log-${timeStarted}.log`,
                `[${time}] ${data[0]} hit rate limit with ${data[1]} requests in the last minute and with query ${data[2]}.\n`,
                () => { }
            )
        case 'Invalid JSON':
            return fs.appendFile(
                `logs/log-${timeStarted}.log`,
                `[${time}] ${data[0]} sent an invalid query ${data[1]}\n`,
                () => { }
            )
        case 'Database Connect':
            return fs.appendFile(
                `logs/log-${timeStarted}.log`,
                `[${time}] Connected to database.\n`,
                () => { }
            )
        default:
            return fs.appendFile(
                `logs/log-${timeStarted}.log`,
                `[${time}] Unknown log type ${type} data: ${JSON.stringify(
                    data
                )}\n`,
                () => { }
            )
    }
}

// Setup AH db loop
async function startAHLoop() {
    // setInterval is bad so here we go!
    // https://dev.to/jsmccrumb/asynchronous-setinterval-4j69
    const asyncIntervals = []
    const runAsyncInterval = async (cb, interval, intervalIndex) => {
        await cb()
        if (asyncIntervals[intervalIndex]) {
            setTimeout(
                () => runAsyncInterval(cb, interval, intervalIndex),
                interval
            )
        }
    }
    const setAsyncInterval = (cb, interval) => {
        if (cb && typeof cb === 'function') {
            const intervalIndex = asyncIntervals.length
            asyncIntervals.push(true)
            runAsyncInterval(cb, interval, intervalIndex)
            return intervalIndex
        } else {
            throw new Error('Callback must be a function')
        }
    }

    async function getAuctionPage(page = 0) {
        return fetch(
            `https://api.hypixel.net/skyblock/auctions?page=${page}&key=${config.hypixelApiKey}`
        ).then((res) => {
            if (!res.ok) {
                return res.statusText
            }
            return res.json()
        })
    }

    async function getFullAH() {
        let ah = []
        let completedPages = 0
        let firstPage = await getAuctionPage(0)
        for (let i = 1; i <= firstPage.totalPages; i++) {
            getAuctionPage(i).then((page) => {
                if (completedPages !== firstPage.totalPages - 1) {
                    completedPages++
                }
                if (page.success) {
                    for (auction of page.auctions) {
                        ah.push(auction)
                        if (completedPages == firstPage.totalPages - 1) {
                            completedPages++
                        }
                    }
                } else if (completedPages == firstPage.totalPages - 1) {
                    completedPages++
                }
            })
        }
        // Wait for the whole ah to download
        while (completedPages !== firstPage.totalPages)
            await new Promise(resolve => setTimeout(resolve, 10))
        return ah
    }

    setAsyncInterval(async () => {
        let startTime = Date.now()
        if (!db.isConnected()) await connectToDB()
        let auctionCollection = skyblock.collection('auctions')

        let ah = await getFullAH()
        auctionCollection.drop()
        auctionCollection.insertMany(ah)

        let timeTaken = Date.now() - startTime
        console.log(`Auction update complete in ${timeTaken} ms`)
        // This essentially is the delay instead of every 60000 ms
        await new Promise(resolve => setTimeout(resolve, 60000 - timeTaken))
    }, 0)
}
