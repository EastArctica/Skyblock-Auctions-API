const MongoClient = require('mongodb').MongoClient
const fetch = require('node-fetch')
const config = require('../config.json')

let lastDBUpdated = 'main'

// Setup AH db loop
async function startAHLoop() {
    // TODO: Change this function name it's to long
    async function getSecondsUntilApiUpdate() {
        let req = await fetch(`https://api.hypixel.net/skyblock/auctions?page=0&key=${config.hypixelApiKey}`)
        // * We use cloudflare age because hypixel is dumb and doesn't align themselves to it so we have to
        let age = Number(req.headers.get('age'))
        
        // when age == null, the api was just updated
        if (age == null)
            return 0
        
        let maxAge = Number(req.headers.get('cache-control').split('s-maxage=')[1]) || 60
        // cloudflare doesn't give us an exact time left in ms, so we could either spam requests for 2.5 second, or just add 2.5 seconds to the seconds left
        return maxAge - age + 2.5
    }

    async function getAuctionPage(page = 0) {
        return fetch(`https://api.hypixel.net/skyblock/auctions?page=${page}&key=${config.hypixelApiKey}`).then((res) => {
            if (!res.ok) {
                return res.statusText
            }
            return res.json()
        })
    }

    async function getFullAH() {
        try {
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
                await new Promise((resolve) => setTimeout(resolve, 10))
            return ah
        } catch (e) {
            console.log('Failed to update auctions', e)
            return
        }
    }

    async function main() {
        let startTime = Date.now()
        let auctionCollectionMain = skyblock.collection('auctionsMain')
        let auctionCollectionCache = skyblock.collection('auctionsCache')
        auctionCollectionCache.createIndex({ starting_bid: 1 })
        auctionCollectionCache.createIndex({ start: 1 })
        auctionCollectionCache.createIndex({ end: 1 })
        auctionCollectionMain.createIndex({ starting_bid: 1 })
        auctionCollectionMain.createIndex({ start: 1 })
        auctionCollectionMain.createIndex({ end: 1 })
        
        let ah = await getFullAH()
        let timeTaken = Date.now() - startTime

        if (typeof ah.ok == 'undefined') {
            // We use a cache database to prevent the database from being empty at any point
            if (lastDBUpdated == 'main') {
                // Drop the cache db, then insert everything and tell the server to use it.
                auctionCollectionCache.drop()
                auctionCollectionCache.insertMany(ah, () => {
                    // Tell the server to use the cache DB instead
                    fetch(`http://localhost:${config.port}/auctions/swapDB/${lastDBUpdated}`).catch(() => {})
                })
                lastDBUpdated = 'cache'
            } else {
                // Drop the main db, then insert everything and tell the server to use it.
                auctionCollectionMain.drop()
                auctionCollectionMain.insertMany(ah, () => {
                    // Tell the server to use the main DB instead
                    fetch(`http://localhost:${config.port}/auctions/swapDB/${lastDBUpdated}`).catch(() => {})
                })
                lastDBUpdated = 'main'
            }

            console.log(`Auction update complete in ${timeTaken} ms ${Date().toLocaleString()}`)
        } else {
            console.log(`Auction update failed in ${timeTaken} ms ${Date().toLocaleString()}`)
        }
        
        // This essentially is the delay instead of every 60000 ms
        setTimeout(main, await getSecondsUntilApiUpdate() * 1000)
    }
    main()
}

// No top level await hurts me mentally.
!(async () => {
    MongoClient.connect(config.mongoSRV, { useNewUrlParser: true, useUnifiedTopology: true }, (err, DB) => {
        db = DB
        skyblock = DB.db('skyblock')
    })
    while (typeof db == 'undefined') {
        await new Promise((resolve) => setTimeout(resolve, 10))
    }
    startAHLoop()
})()