
var mongoose = require("mongoose");

var vistaSchema = new mongoose.Schema({
	name: String,
	rating: Number,
	city: String,
	locationlat: Number,
	locationlon: Number,
	description: String,
	directions: String,
	category: String,
	image: String,
	imageId: String,
	author: {
      id: {
         type: mongoose.Schema.Types.ObjectId,
         ref: "User"
      },
      username: String
    },
	comments: [
        {
        	type: mongoose.Schema.Types.ObjectId,
        	ref: "Comment"
        }
    ]
});

module.exports = mongoose.model("Vista", vistaSchema);
