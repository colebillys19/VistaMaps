
/****************************************************************************************************/
// SETUP
/****************************************************************************************************/

var
methodOverride   = require("method-override"),
LocalStrategy    = require("passport-local"),
bodyParser       = require("body-parser"),
nodemailer       = require("nodemailer"),
cloudinary       = require("cloudinary"),
mongoose         = require("mongoose"),
passport         = require("passport"),
express          = require("express"),
Comment          = require("./models/comment"),
multer           = require("multer"),
crypto           = require("crypto"),
Vista            = require("./models/vista"),
flash            = require("connect-flash"),
async            = require("async"),
User             = require("./models/user");

// app variable
var app = express();
// flash for error, success messages
app.use(flash());










/****************************************************************************************************/
// IMAGE UPLOAD
/****************************************************************************************************/

// multer storage variable
var storage = multer.diskStorage({
    filename: function(req, file, callback) {
        callback(null, Date.now() + file.originalname);
    }
});

// specifies file type
var imageFilter = function (req, file, cb) {
    // accept image files only
    if (!file.originalname.match(/\.(jpg|jpeg|png|gif)$/i)) {
        return cb(new Error('Only image files are allowed!'), false);
    }
    cb(null, true);
};

// upload variable
var upload = multer({ storage: storage, fileFilter: imageFilter})

// cloudinary info
cloudinary.config({ 
    cloud_name: process.env.CLOUDNAME,
    api_key: process.env.CLOUDINARYAPIKEY, 
    api_secret: process.env.CLOUDINARYAPISECRET
});










/****************************************************************************************************/
// PASSPORT
/****************************************************************************************************/

app.use(require("express-session")({
    secret: "asighttobehold",
    resave: false,
    saveUninitialized: false
}));
app.use(passport.initialize());
app.use(passport.session());
passport.use(new LocalStrategy(User.authenticate()));
passport.serializeUser(User.serializeUser());
passport.deserializeUser(User.deserializeUser());










/****************************************************************************************************/
// MISC
/****************************************************************************************************/

mongoose.connect(process.env.DATABASEURL, {useNewUrlParser: true});
mongoose.set('useFindAndModify', false); // deprecation fix
mongoose.set('useCreateIndex', true); // deprecation fix
app.use(bodyParser.urlencoded({extended: true}));
app.set("view engine", "ejs");
app.use(express.static('public'));
app.use(methodOverride("_method"));
app.use(flash());

// define res.locals
app.use(function(req, res, next){
    res.locals.currentUser = req.user;
    res.locals.error = req.flash("error");
    res.locals.success = req.flash("success");
    next();
});










// landing
app.get("/", function(req, res){
    res.render("landing");
});

/****************************************************************************************************/
/****************************************************************************************************/
/****************************************************************************************************/
// VISTA ROUTES
/****************************************************************************************************/
/****************************************************************************************************/
/****************************************************************************************************/

// define escapeRegex for index search string formatting
function escapeRegex(text) {
    return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
};

// INDEX - displays all vistas
app.get("/vistas", function(req, res){
    var perPage = 9;
    var pageQuery = parseInt(req.query.page);
    var pageNumber = pageQuery ? pageQuery : 1;
    var noMatch = null;
    if(req.query.search) {
        // get vistas matching search from db
        var regex = new RegExp(escapeRegex(req.query.search), 'gi');
        Vista.find({name: regex}).skip((perPage * pageNumber) - perPage).limit(perPage).exec(function (err, allVistas) {
            Vista.countDocuments({name: regex}).exec(function (err, count) {
                if (err) {
                    console.log(err);
                    res.redirect("back");
                } else {
                    if(allVistas.length < 1) {
                        noMatch = "No vistas found.";
                    }
                    res.render("vistas/index", {
                        vistas: allVistas,
                        current: pageNumber,
                        pages: Math.ceil(count / perPage),
                        noMatch: noMatch,
                        search: req.query.search
                    });
                }
            });
        });
    } else {
        // get all vistas from db
        Vista.find({}).skip((perPage * pageNumber) - perPage).limit(perPage).exec(function (err, allVistas) {
            Vista.countDocuments().exec(function (err, count) {
                if (err) {
                    console.log(err);
                    res.redirect("back");
                } else {
                    res.render("vistas/index", {
                        vistas: allVistas,
                        current: pageNumber,
                        pages: Math.ceil(count / perPage),
                        noMatch: noMatch,
                        search: false
                    });
                }
            });
        });
    }
});

// NEW - displays form to create new vista
app.get("/vistas/new", isLoggedIn, function(req, res){
    res.render("vistas/new"); 
});

//CREATE - add new vista to the db
app.post("/vistas", isLoggedIn, upload.single('image'), function(req, res){
    // upload image to cloudinary
    cloudinary.v2.uploader.upload(req.file.path, function(err, result) {
        if(err) {
            console.log(err);
            req.flash('error', err.message);
            res.redirect('back');
        }
        // add cloudinary url for the image to the vista object
        req.body.vista.image = result.secure_url;
        // add image's public_id to vista object
        req.body.vista.imageId = result.public_id;
        // add author to vista object
        req.body.vista.author = {
            id: req.user._id,
            username: req.user.username
        }
        // create vista
        Vista.create(req.body.vista, function(err, vista) {
            if (err) {
                console.log(err);
                req.flash('error', err.message);
                res.redirect('back');
            }
            return res.redirect('/vistas/' + vista.id);
        });
    });
});

// SHOW - displays info about a vista
app.get("/vistas/:id", function(req, res){
    //find the vista with provided ID
    Vista.findById(req.params.id).populate("comments").exec(function(err, foundVista){
        if(err || !foundVista){
            console.log(err);
            req.flash('error', 'Sorry, that vista does not exist!');
            res.redirect('/vistas');
        }
        //render page
        res.render("vistas/show", {vista: foundVista});
    });
});

// EDIT - displays edit form for a vista
app.get("/vistas/:id/edit", isLoggedIn, checkVistaOwnership, function(req, res){
    res.render("vistas/edit", {vista: req.vista});
});

// UPDATE - commits new info to a vista
app.put("/vistas/:id", upload.single('image'), function(req, res) {
    // find specified vista
    Vista.findById(req.params.id, async function(err, vista){
        if(err) {
            console.log(err);
            req.flash("error", err.message);
            res.redirect("back");
        } else {
            // if new image file added
            if(req.file) {
                try {
                    // delete old image
                    await cloudinary.v2.uploader.destroy(vista.imageId);
                    // upload new image
                    var result = await cloudinary.v2.uploader.upload(req.file.path);
                    // assign new image to vista
                    vista.imageId = result.public_id;
                    vista.image = result.secure_url;
                } catch(err) {
                    console.log(err);
                    req.flash("error", err.message);
                    res.redirect("back");
                }
            }
            // save any other changes made to vista
            vista.name = req.body.vista.name;
            vista.rating = req.body.vista.rating;
            vista.city = req.body.vista.city;
            vista.locationlat = req.body.vista.locationlat;
            vista.locationlon = req.body.vista.locationlon;
            vista.rating = req.body.vista.rating;
            vista.description = req.body.vista.description;
            vista.directions = req.body.vista.directions;
            vista.category = req.body.vista.category;
            vista.save();
            req.flash("success", "Successfully Updated!");
            return res.redirect("/vistas/" + vista._id);
        }
    });
});

// DELETE - deletes a vista from the db
app.delete("/vistas/:id", checkVistaOwnership, function(req, res) {
    Vista.findById(req.params.id, async function(err, vista) {
        if (err) {
            console.log(err);
            req.flash("error", err.message);
            res.redirect("back");
        }
        try {
            // delete image from cloudinary
            await cloudinary.v2.uploader.destroy(vista.imageId);
            // delete vista
            vista.remove();
            req.flash("success", "Vista deleted successfully!");
            return res.redirect("/vistas");
        } catch(err) {
            console.log(err);
            req.flash("error", err.message);
            res.redirect("back");
        }
    });
});










/****************************************************************************************************/
/****************************************************************************************************/
/****************************************************************************************************/
// COMMENT ROUTES
/****************************************************************************************************/
/****************************************************************************************************/
/****************************************************************************************************/

// NEW - displays form to create a new comment
app.get("/vistas/:id/comments/new", isLoggedIn, function(req, res){
    // find vista by id
    Vista.findById(req.params.id, function(err, vista){
        if(err){
            console.log(err);
            res.redirect("back");
        } else {
            //render comment form
            res.render("comments/new", {vista: vista});
        }
    });
});

// CREATE - append a new comment to vista
app.post("/vistas/:id/comments", isLoggedIn, function(req, res){
    // find vista by id
    Vista.findById(req.params.id, function(err, vista){
        if(err){
            console.log(err);
            res.redirect("/vistas");
        } else {
            //create new comment
            Comment.create(req.body.comment, function(err, comment){
                if(err){
                    console.log(err);
                    req.flash("error", "Something went wrong.");
                    res.redirect("/vistas");
                } else {
                    //add username and id to comment
                    comment.author.id = req.user._id;
                    comment.author.username = req.user.username;
                    //save comment
                    comment.save();
                    //append new comment to vista
                    vista.comments.push(comment);
                    vista.save();
                    req.flash("success", "Successfully added comment.");
                    return res.redirect('/vistas/' + vista._id);
                }
            });
        }
    });
});

// EDIT - displays edit form for specified comment
app.get("/vistas/:id/comments/:comment_id/edit", isLoggedIn, checkCommentOwnership, function(req, res){
    res.render("comments/edit", {vista_id: req.params.id, comment: req.comment});
});


// UPDATE - commits changes to a comment
app.put("/vistas/:id/comments/:comment_id", checkCommentOwnership, function(req, res){
    Comment.findByIdAndUpdate(req.params.comment_id, req.body.comment, function(err, updatedComment){
        if(err){
            console.log(err);
            res.redirect("/vistas");
        } else {
            return res.redirect("/vistas/" + req.params.id );
        }
    });
});

// DELETE - deletes a specified comment
app.delete("/vistas/:id/comments/:comment_id", checkCommentOwnership, function(req, res){
    Comment.findByIdAndRemove(req.params.comment_id, function(err){
        if(err){
            console.log(err);
            res.redirect("back");
        } else {
            req.flash("success", "Comment deleted.");
            return res.redirect("/vistas/" + req.params.id);
        }
    });
});










/****************************************************************************************************/
/****************************************************************************************************/
/****************************************************************************************************/
// MISCELLANEOUS ROUTES
/****************************************************************************************************/
/****************************************************************************************************/
/****************************************************************************************************/

// displays sign up form
app.get("/register", function(req, res) {
    res.render("register");
});

// handles sign up logic
app.post("/register", function(req, res){
    // make sure passwords match
    if(req.body.password !== req.body.confirm) {
        req.flash("error", "Passwords do not match.");
        return res.redirect('back');
    }
    // create new user object
    var newUser = new User({
        username: req.body.username,
        firstName: req.body.firstName,
        lastName: req.body.lastName,
        email: req.body.email,
        avatar: req.body.avatar
    });
    // check if admin
    if(req.body.adminCode === process.env.ADMINCODE){
        newUser.isAdmin = true;
    };
    // save user to db
    User.register(newUser, req.body.password, function(err, user){
        if(err){
            console.log(err);
            req.flash("error", err.message);
            res.redirect("/register");
        }
        passport.authenticate("local")(req, res, function(){
            req.flash("success", "Welcome to VistaMaps!");
            return res.redirect("/vistas");
        });
    });
});

// displays login form
app.get("/login", function(req, res){
    res.render("login");
});

// handles login logic
app.post("/login", passport.authenticate("local", {
    successRedirect: "/vistas",
    failureRedirect: "/login",
    successFlash: "Welcome back!",
    failureFlash: true
}), function(req, res){});

// logs a user out
app.get("/logout", function(req, res){
    req.logout();
    req.flash("success", "Successfully logged out.");
    return res.redirect("/vistas");
});

// displays the forgot password form
app.get('/forgot', function(req, res) {
    res.render('forgot');
});

// sends an email confirming/propmting password reset
app.post('/forgot', function(req, res, next) {
    async.waterfall([
        function(done) {
            // create random token 
            crypto.randomBytes(20, function(err, buf) {
                if(err) {
                    console.log(err);
                    req.flash("error", "Something went wrong.");
                    res.redirect('back');
                }
                var token = buf.toString('hex');
                done(err, token);
            });
        },
        function(token, done) {
            // find user with matching email
            User.findOne({ email: req.body.email }, function(err, user) {
                if(err) {
                    console.log(err);
                    req.flash("error", "Something went wrong.");
                    res.redirect('back');
                }
                if (!user) {
                    req.flash('error', 'No account with that email address exists.');
                    return res.redirect('/forgot');
                }
                // assign reset password token
                user.resetPasswordToken = token;
                // token expires after 1 hour
                user.resetPasswordExpires = Date.now() + 3600000;
                user.save(function(err) {
                    if(err) {
                        console.log(err);
                        req.flash("error", "Something went wrong.");
                        res.redirect('back');
                    }
                    done(err, token, user);
                });
            });
        },
        function(token, user, done) {
            // email sender details
            var smtpTransport = nodemailer.createTransport({
                service: 'Gmail', 
                auth: {
                    user: '919wsc@gmail.com',
                    pass: process.env.GMAILPW
                }
            });
            // email details
            var mailOptions = {
                to: user.email,
                from: '919wsc@gmail.com',
                subject: 'Node.js Password Reset',
                text: 'You are receiving this because you (or someone else) have requested the reset of the password for your VistaMaps account.\n\n' +
                      'Please click on the following link, or paste this into your browser to complete the process:\n\n' +
                      'http://' + req.headers.host + '/reset/' + token + '\n\n' +
                      'If you did not request this, please ignore this email and your password will remain unchanged.\n'
            };
            // send email
            smtpTransport.sendMail(mailOptions, function(err) {
                console.log('mail sent');
                req.flash('success', 'An e-mail has been sent to ' + user.email + ' with further instructions.');
                done(err, 'done');
            });
        }
    ], function(err) {
        if(err) {
            console.log(err);
            return next(err);
        }
        return res.redirect('/forgot');
    });
});

// displays password reset form
app.get('/reset/:token', function(req, res) {
    // via token, find user whose password is being changed
    User.findOne({ resetPasswordToken: req.params.token, resetPasswordExpires: { $gt: Date.now() } }, function(err, user) {
        if(err) {
            console.log(err);
            req.flash("error", "Something went wrong.");
            res.redirect('back');
        }
        if (!user) {
            req.flash('error', 'Password reset token is invalid or has expired.');
            return res.redirect('/forgot');
        }
        // render form
        res.render('reset', {token: req.params.token});
    });
});

// handles password reset logic
app.post('/reset/:token', function(req, res) {
    async.waterfall([
        function(done) {
            // via token, find user whose password is being changed
            User.findOne({ resetPasswordToken: req.params.token, resetPasswordExpires: { $gt: Date.now() } }, function(err, user) {
                if(err) {
                    console.log(err);
                    req.flash("error", "Something went wrong.");
                    res.redirect('back');
                }
                if (!user) {
                    req.flash('error', 'Password reset token is invalid or has expired.');
                    return res.redirect('back');
                }
                // check if new passwords match
                if(req.body.password === req.body.confirm) {
                    user.setPassword(req.body.password, function(err) {
                        if(err) {
                            console.log(err);
                            req.flash("error", "Something went wrong.");
                            res.redirect('back');
                        }
                        // get rid of used token
                        user.resetPasswordToken = undefined;
                        user.resetPasswordExpires = undefined;
                        // save user object with new password
                        user.save(function(err) {
                            if(err) {
                                console.log(err);
                                req.flash("error", "Something went wrong.");
                                res.redirect('back');
                            }
                            req.logIn(user, function(err) {
                                if (err) {
                                    console.log(err);
                                    req.flash("error", "Something went wrong.");
                                    res.redirect('back');
                                }
                                done(err, user);
                            });
                        });
                    })
                } else {
                    req.flash("error", "Passwords do not match.");
                    return res.redirect('back');
                }
            });
        },
        // password change confirmation email
        function(user, done) {
            // email sender details 
            var smtpTransport = nodemailer.createTransport({
                service: 'Gmail', 
                auth: {
                    user: '919wsc@gmail.com',
                    pass: process.env.GMAILPW
                }
            });
            // email details
            var mailOptions = {
                to: user.email,
                from: '919wsc@gmail.com',
                subject: 'Your password has been changed',
                text: 'Hello,\n\n' +
                  'This is a confirmation that the password for your VistaMaps account has just been changed.\n'
            };
            // send email
            smtpTransport.sendMail(mailOptions, function(err) {
                if(err) {
                    console.log(err);
                    req.flash("error", "Something went wrong.");
                    res.redirect('back');
                }
                req.flash('success', 'Success! Your password has been changed.');
                done(err);
            });
        }
    ], function(err) {
        if(err) {
            console.log(err);
            req.flash("error", "Something went wrong.");
            res.redirect('back');
        }
        return res.redirect('/vistas');
    });
});

// displays user profile
app.get("/users/:id", function(req, res){
    // find specified user
    User.findById(req.params.id, function(err, foundUser){
        if(err){
            console.log(err);
            req.flash("error", "Something went wrong.");
            res.redirect("/vistas/");
        }
        // find vistas created by user
        Vista.find().where("author.id").equals(foundUser._id).exec(function(err, vistas){
            if(err){
                console.log(err);
                req.flash("error", "Something went wrong.");
                res.redirect("/vistas/");
            }
            res.render("users/show", {user: foundUser, vistas: vistas});
        });
    });
});










/****************************************************************************************************/

// Wildcard
app.get("/*", function(req, res) {
    res.render("wildcard");
});











/****************************************************************************************************/
// MIDDLEWARE
/****************************************************************************************************/

// checks if user is logged in
function isLoggedIn(req, res, next) {
    if(req.isAuthenticated()){
        return next();
    }
    req.flash("error", "You need to be logged in to do that.");
    res.redirect("/login");
};

// checks if current user created specified vista
function checkVistaOwnership(req, res, next){
    Vista.findById(req.params.id, function(err, foundVista){
        if(err || !foundVista){
            console.log(err);
            req.flash("error", "Sorry, that Vista does not exist!");
            res.redirect("/vistas");
        } else if( (foundVista.author.id.equals(req.user._id) || req.user.isAdmin) || (req.user.isAdmin) ){
            req.vista = foundVista;
            next();
        } else {
            req.flash("error", "You don't have permission to do that.");
            return res.redirect("/vistas/" + req.params.id);
        }
    });
  };

// checks if current user created specified comment
function checkCommentOwnership(req, res, next){
    Comment.findById(req.params.comment_id, function(err, foundComment){
        if(err || !foundComment){
            console.log(err);
            req.flash("error", "Sorry, that comment does not exist!");
            res.redirect("/vistas");
        } else if( (foundComment.author.id.equals(req.user._id) || req.user.isAdmin) || (req.user.isAdmin) ){
            req.comment = foundComment;
            next();
        } else {
            req.flash("error", "You don't have permission to do that!");
            return res.redirect("/vistas/" + req.params.id);
        }
    });
};










/****************************************************************************************************/

// Listen
app.listen(process.env.PORT || 3000, function() {
	console.log("Serving...");
});









