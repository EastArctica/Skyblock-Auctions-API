const { exec } = require("child_process")

setInterval(() => {
	exec("pm2 restart updateDB")
}, 30 * 60 * 1000)
// min  sec  ms
