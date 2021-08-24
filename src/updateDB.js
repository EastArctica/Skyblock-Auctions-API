const MongoClient = require('mongodb').MongoClient
const fetch = require('node-fetch')
const config = require('../config.json')

console.warn = function(...args) { console.log('\x1b[33m%s\x1b[0m', ...args) }
console.error = function(...args) { console.log('\x1b[31m%s\x1b[0m', ...args) }

let skyblock
let db

class Environment {
    constructor(env, db, handler) {
        this.env = env
        this.lastDBUpdated = db
        this.handlerPath = handler
    }
    getCollection() {
        // TODO: Handle collections not existing, If there is no collection it will create it but will throw a warning
        // skyblock.createCollection(this.env + (this.lastDBUpdated == 'main' ? '_auctionsMain' : '_auctionsCache'))
        return skyblock.collection(this.env + (this.lastDBUpdated == 'main' ? '_auctionsMain' : '_auctionsCache'))
    }
    getHandler() {
        delete require.cache[require.resolve(this.handlerPath)]
        return require(this.handlerPath).handler || ((x) => x)
    }
}

const handlers = {
    prod: './DB-Updater/Handlers/prod.js',
    dev: './DB-Updater/Handlers/dev.js',
   staging: './DB-Updater/Handlers/staging.js'
}

let environments = {
    prod: new Environment('prod', 'main', handlers.prod),
    dev: new Environment('dev', 'main', handlers.dev),
    // staging: new Environment('staging', 'main', handlers.prod)
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
}

async function getSecondsUntilApiUpdate() {
    let req = await fetch(`https://api.hypixel.net/skyblock/auctions?page=0&key=${config.hypixelApiKey}`)
    // * We use cloudflare age because hypixel is dumb and doesn't align themselves to it so we have to
    let age = Number(req.headers.get('age'))

    // * when age == null, the api was just updated
    if (age == null)
        return 0

    let maxAge = Number(req.headers.get('cache-control').split('s-maxage=')[1]) || 60
    // * cloudflare doesn't give us an exact time left in ms, so we could either spam requests for 2.5 second, or just add 2.5 seconds to the seconds left
    return maxAge - age + 2 || 50
}

async function getAuctionPage(page = 0) {
    // ! This api doesn't actually require a key, but it might in the future
    return fetch(`https://api.hypixel.net/skyblock/auctions?page=${page}&key=${config.hypixelApiKey}`).then((res) => {
        if (!res.ok) {
            throw new Error(res)
        }
        return res.json()
    })
}

async function getFullAH() {
    let totalPages = (await getAuctionPage(0)).totalPages

    let res = await new Promise(async (resolve) => {
        let completedPages = []
        let failedPages = []
        let ah = []
        for (let pageNum = 0; pageNum < totalPages; pageNum++) {
            getAuctionPage(pageNum).then((page) => {
                ah = ah.concat(page.auctions)
                completedPages.push(pageNum)
                if ((completedPages.length + failedPages.length) === totalPages)
                    return resolve({
                        ok: true,
                        auctions: ah,
                        completedPages: completedPages,
                        failedPages: failedPages
                    })
            }).catch((e) => {
                failedPages.push(pageNum)
                console.error(`Failed to get page ${pageNum}, Failed ${failedPages.length} pages so far.`)
                if ((completedPages.length + failedPages.length) === totalPages)
                    return resolve({
                        ok: true,
                        auctions: ah,
                        completedPages: completedPages,
                        failedPages: failedPages
                    })
            })
        }
    })

    return res
}

// Setup AH db loop
async function startAHLoop() {
    while (true) {
        let startTime = Date.now()
        // TODO: Add indexes
        let ah = await getFullAH()
        let ahFinishTime = Date.now()
        
        if (ah.failedPages.length != 0)
            console.warn(`Failed to get ${ah.failedPages.length} pages. Successfully got ${ah.completedPages.length} pages`)
        console.log (`Got ${ah.auctions.length} auctions, inserting...`)

        let insertPromises = []
        if (ah.ok) {
            for (let env in environments) {
                // TODO: Rewrite this, it's bad.
                try {
                    insertPromises.push(new Promise(async (resolve, reject) => {
                        let envObj = environments[env]
                        envObj.lastDBUpdated = envObj.lastDBUpdated == 'main' ? 'cache' : 'main'

                        let collection = envObj.getCollection()
                        collection.drop()
                        // collection.createIndex({
                        //     starting_bid: 1,
                        //     start: -1,
                        //     current_bid: 1,
                        // })
                        collection.initializeOrderedBulkOp()
                        let start = Date.now()
                        let toInsert = await envObj.getHandler()(ah.auctions)
                        
                        collection.insertMany(toInsert || ah.auctions, async () => {
                            console.log(`Inserted ${toInsert.length} auctions into ${envObj.env + (envObj.lastDBUpdated == 'main' ? '_auctionsMain' : '_auctionsCache')} in ${Date.now()-start}ms`)
                            await fetch(`http://localhost:${config.port}/skyblock/auctions/swapDB/${envObj.env}/${envObj.lastDBUpdated}?key=ZFAzbAWZLh42oggnY72JTccdu32KCF`).catch(e => {
                                console.error('Failed to swap DB', e)
                            })
                            resolve()
                        })
                    }))
                } catch (e) { }
            }
            await Promise.all(insertPromises)
            console.log(`PageTime: ${ahFinishTime - startTime}ms, ExtraTime: ${Date.now() - startTime}ms - ${Date().toLocaleString('en-US', { timeZone: 'EST' })}`)
        } else {
            console.error(`Auction update failed in ${Date.now() - startTime}ms ${Date().toLocaleString('en-US', { timeZone: 'EST' })}`) // TODO: Add error handling, this is never actually called
        }

        // This essentially is the delay instead of every 60000 ms
        let nextUpdate = await getSecondsUntilApiUpdate() * 1000
        console.log(`Next update in ${nextUpdate}ms`)
        console.log(' ')
        await sleep(nextUpdate)
    }
}

// No top level await hurts me mentally.
!(async () => {
    MongoClient.connect(config.mongoSRV_ReadWrite, { useNewUrlParser: true, useUnifiedTopology: true }, (err, DB) => {
        db = DB
        skyblock = DB.db('skyblock')
    })
    while (typeof db == 'undefined') {
        await new Promise((resolve) => setTimeout(resolve, 10))
    }
    startAHLoop()
})()
