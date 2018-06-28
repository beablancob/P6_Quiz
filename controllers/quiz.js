const Sequelize = require("sequelize");
const Op = Sequelize.Op;
const {models} = require("../models");

const paginate = require('../helpers/paginate').paginate;

// Autoload the quiz with id equals to :quizId
exports.load = (req, res, next, quizId) => {

    models.quiz.findById(quizId, {
        include: [
            {model: models.tip, include: [{model: models.user, as: 'author'}]},

            {model: models.user, as: 'author'}
        ]
    })
    .then(quiz => {
        if (quiz) {
            req.quiz = quiz;
            next();
        } else {
            throw new Error('There is no quiz with id=' + quizId);
        }
    })
    .catch(error => next(error));
};

// MW that allows actions only if the user logged in is admin or is the author of the quiz.
exports.adminOrAuthorRequired = (req, res, next) => {

    const isAdmin  = !!req.session.user.isAdmin;
    const isAuthor = req.quiz.authorId === req.session.user.id;

    if (isAdmin || isAuthor) {
        next();
    } else {
        console.log('Prohibited operation: The logged in user is not the author of the quiz, nor an administrator.');
        res.send(403);
    }
};




// GET /quizzes
exports.index = (req, res, next) => {

    let countOptions = {
        where: {}
    };

    let title = "Questions";

    // Search:
    const search = req.query.search || '';
    if (search) {
        const search_like = "%" + search.replace(/ +/g,"%") + "%";

        countOptions.where.question = { [Op.like]: search_like };
    }

    // If there exists "req.user", then only the quizzes of that user are shown
    if (req.user) {
        countOptions.where.authorId = req.user.id;
        title = "Questions of " + req.user.username;
    }

    models.quiz.count(countOptions)
    .then(count => {

        // Pagination:

        const items_per_page = 10;

        // The page to show is given in the query
        const pageno = parseInt(req.query.pageno) || 1;

        // Create a String with the HTMl used to render the pagination buttons.
        // This String is added to a local variable of res, which is used into the application layout file.
        res.locals.paginate_control = paginate(count, items_per_page, pageno, req.url);

        const findOptions = {
            ...countOptions,
            offset: items_per_page * (pageno - 1),
            limit: items_per_page,
            include: [{model: models.user, as: 'author'}]
        };

        return models.quiz.findAll(findOptions);
    })
    .then(quizzes => {
        res.render('quizzes/index.ejs', {
            quizzes, 
            search,
            title
        });
    })
    .catch(error => next(error));
};


// GET /quizzes/:quizId
exports.show = (req, res, next) => {

    const {quiz} = req;

    res.render('quizzes/show', {quiz});
};


// GET /quizzes/new
exports.new = (req, res, next) => {

    const quiz = {
        question: "", 
        answer: ""
    };

    res.render('quizzes/new', {quiz});
};

// POST /quizzes/create
exports.create = (req, res, next) => {

    const {question, answer} = req.body;

    const authorId = req.session.user && req.session.user.id || 0;

    const quiz = models.quiz.build({
        question,
        answer,
        authorId
    });

    // Saves only the fields question and answer into the DDBB
    quiz.save({fields: ["question", "answer", "authorId"]})
    .then(quiz => {
        req.flash('success', 'Quiz created successfully.');
        res.redirect('/quizzes/' + quiz.id);
    })
    .catch(Sequelize.ValidationError, error => {
        req.flash('error', 'There are errors in the form:');
        error.errors.forEach(({message}) => req.flash('error', message));
        res.render('quizzes/new', {quiz});
    })
    .catch(error => {
        req.flash('error', 'Error creating a new Quiz: ' + error.message);
        next(error);
    });
};


// GET /quizzes/:quizId/edit
exports.edit = (req, res, next) => {

    const {quiz} = req;

    res.render('quizzes/edit', {quiz});
};


// PUT /quizzes/:quizId
exports.update = (req, res, next) => {

    const {quiz, body} = req;

    quiz.question = body.question;
    quiz.answer = body.answer;

    quiz.save({fields: ["question", "answer"]})
    .then(quiz => {
        req.flash('success', 'Quiz edited successfully.');
        res.redirect('/quizzes/' + quiz.id);
    })
    .catch(Sequelize.ValidationError, error => {
        req.flash('error', 'There are errors in the form:');
        error.errors.forEach(({message}) => req.flash('error', message));
        res.render('quizzes/edit', {quiz});
    })
    .catch(error => {
        req.flash('error', 'Error editing the Quiz: ' + error.message);
        next(error);
    });
};


// DELETE /quizzes/:quizId
exports.destroy = (req, res, next) => {

    req.quiz.destroy()
    .then(() => {
        req.flash('success', 'Quiz deleted successfully.');
        res.redirect('/goback');
    })
    .catch(error => {
        req.flash('error', 'Error deleting the Quiz: ' + error.message);
        next(error);
    });
};


// GET /quizzes/:quizId/play
exports.play = (req, res, next) => {

    const {quiz, query} = req;

    const answer = query.answer || '';

    res.render('quizzes/play', {
        quiz,
        answer
    });
};


// GET /quizzes/:quizId/check
exports.check = (req, res, next) => {

    const {quiz, query} = req;

    const answer = query.answer || "";
    const result = answer.toLowerCase().trim() === quiz.answer.toLowerCase().trim();

    res.render('quizzes/result', {
        quiz,
        result,
        answer
    });
};

/**
 * El objetivo de este método es preguntar al cliente los quizzes que todavia no han sido preguntados de forma
 * aleatoria. Asi, lo primero q comprobamos es que se haya preguntado ya alguna vez al cliente. En caso contrario,
 * inicializamos el juego guardando variables de score y un almacen de los quizzes.
 *
 * Una vez inicializado procedemos a crear un numero aleatorio comprendido entre el numero de quizzes que existe.
 * Ese numero será el numero del quizz que preguntemos al cliente, saliendo por pantalla éste con su score, en este caso 0.
 *
 * Si ya habia jugado anteriormente, cargamos los quizzes que todavía no se han preguntado. Volvemos a preguntar por el
 * quiz que ha salido aleatoriamente, que sale por pantalla junto con la puntuacion que lleva hasta el momento
 *
 *
 * @param req
 * @param res
 * @param next
 */
exports.randomPlay = function (req, res, next) {



    console.log("quizzes: " + req.session.quizzes);
    console.log("score: "+ req.session.score);
    const {quiz, query} = req;
    const answer = query.answer || "";
    var Nalmacen = 0;
    var almacen = [];

    //creo una variable global score de la sesion:

    //hago lo mismo con un almacen de quizzes
    if(req.session.quizzes === undefined){
        req.session.score =0;
        models.quiz.findAll()
            .then(quizzes => {

                req.session.quizzes = quizzes;

                console.log("quizzes: " + req.session.quizzes);
                console.log("score: "+ req.session.score);

                Nalmacen = req.session.quizzes.length;
                var i = Math.floor(Math.random() * Nalmacen);
                var quizz = req.session.quizzes[i];
                req.session.quizzes.splice(i, 1); //elimina el quiz[i] del almacen porque ya va a ser preguntado en la siguiente linea
                res.render('quizzes/random_play', {
                    score: req.session.score,
                    quiz: quizz
                });
            })
            .catch(err => console.log(err));

    }else{
        almacen = req.session.quizzes;
        if(almacen.length === 0){
            var score = req.session.score;

            res.render('quizzes/random_nomore', {score: score});
        }else{
            Nalmacen = req.session.quizzes.length;
            var i = Math.floor(Math.random() * Nalmacen);
            var quizz = req.session.quizzes[i];
            req.session.quizzes.splice(i, 1);
            res.render('quizzes/random_play', {
                score: req.session.score,
                quiz: quizz
            });
        }
    }
};


exports.randomCheck = (req, res, next) => {

    const {quiz, query} = req;

    const answer = query.answer || "";
    const result = answer.toLowerCase().trim() === quiz.answer.toLowerCase().trim();
    var score;

    if (result) {
        req.session.score++;
        score = req.session.score;
        if(req.session.quizzes.length===0){
            delete req.session.quizzes;
            delete req.session.score;
            res.render('quizzes/random_nomore', {score: score});
        }else{

            res.render('quizzes/random_result', {
                answer: answer,
                quiz: quiz,
                result: result,
                score: score
            });
        }
    }else{
        score = req.session.score;
        delete req.session.quizzes;
        delete req.session.score;
        res.render('quizzes/random_result', {
            answer: answer,
            quiz: quiz,
            result: result,
            score: score
        });
    }
};