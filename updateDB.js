const MongoClient = require('mongodb').MongoClient
const fetch = require('node-fetch')
const config = require('./config.json')
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
        // cloudflare doesn't give us an exact time left in ms, so we could either spam requests for 2.5 second, or just add a second to the seconds left
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
        if (!db.isConnected()) await connectToDB()
        let auctionCollection = skyblock.collection('auctions')

        let ah = await getFullAH()
        let timeTaken = Date.now() - startTime

        if (typeof ah.ok == 'undefined') {
            auctionCollection.drop()
            auctionCollection.insertMany(ah)
            console.log(`Auction update complete in ${timeTaken} ms ${Date().toLocaleString()}`)
        } else {
            console.log(`Auction update failed in ${timeTaken} ms ${Date().toLocaleString()}`)
        }
        
        // This essentially is the delay instead of every 60000 ms
        setTimeout(main, await getSecondsUntilApiUpdate() * 1000)
    }
    main()
}

async function connectToDB(isFirstConnect) {
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
    console.log('Successful connection to database')
    if (isFirstConnect) startAHLoop()
    return db
}
connectToDB(true)

