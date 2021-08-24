const zlib = require('zlib')
const nbt = require('nbt')

function dev(ah) {
    let newAH = JSON.parse(JSON.stringify(ah))
    let start = Date.now()
        for (let auction of newAH) {
            const buffer = zlib.gunzipSync(Buffer.from(auction.item_bytes, 'base64'))
            nbt.parse(buffer, function(error, data) {
                if (error) return console.log(error)
                auction.nbt = data
                auction.gunzippedNBTString = buffer.toString('utf8')
            })
            auction.current_bid = auction.bids.length > 0 ? auction.bids[auction.bids.length - 1].amount : auction.starting_bid
            try {
                auction.item_id = auction.nbt.value.i.value.value[0].tag.value.ExtraAttributes.value.id.value
            } catch (e) {
            }
        }
    console.log('dev finished in ' + (Date.now() - start) + 'ms')
    return newAH
}
exports.handler = dev
