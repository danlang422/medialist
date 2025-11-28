import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import 'dotenv/config';

const app = express();
const port = 3000;

const pgPassword = process.env.DB_PASSWORD;

const db = new pg.Client({
  user: "postgres",
  host: "localhost",
  database: "medialist",
  password: pgPassword,
  port: 5432,
});

db.connect();

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public")); 

async function searchGoogleBooks(title, author) {
    const searchQuery = `${title} ${author}`;
    const encodedQuery = encodeURIComponent(searchQuery);
    const googleApiURL = `https://www.googleapis.com/books/v1/volumes?q=${searchQuery}`;

    const response = await fetch(googleApiURL);
    const data = await response.json();

    const thumbnailUrl = data.items?.[0]?.volumeInfo?.imageLinks?.thumbnail;
    const coverUrl = thumbnailUrl?.replace('zoom=1', 'zoom=3') || '';
    const publishedDate = data.items?.[0]?.volumeInfo?.publishedDate;
    const publicationYear = publishedDate ? publishedDate.split('-')[0] : '';

    return {
        isbn: data.items?.[0]?.volumeInfo?.industryIdentifiers?.[0]?.identifier,
        coverUrl: coverUrl,
        publicationYear: publicationYear
    };
}

async function searchTMDBMovie(title) {
    const searchQuery = `${title}`;
    const encodedQuery = encodeURIComponent(searchQuery);
    const tmdbApiKey = process.env.TMDB_API_KEY;
    const tmdbApiUrl = `https://api.themoviedb.org/3/search/movie?api_key=${tmdbApiKey}&query=${searchQuery}`;

    const response = await fetch(tmdbApiUrl);
    const data = await response.json();

    const tmdbImageBase = 'https://image.tmdb.org/t/p/w500/';
    const posterPath = data.results?.[0]?.poster_path;
    const posterUrl = posterPath ? tmdbImageBase + posterPath : '';
    const releaseDate = data.results?.[0]?.release_date;
    const releaseYear = releaseDate ? releaseDate.split('-')[0] : '';

    return {
        title: data.results?.[0]?.title,
        releaseYear: releaseYear,
        posterUrl: posterUrl
    };
}

app.get("/", async (req, res) => {
    try {
        const result = await db.query("SELECT * FROM booklist ORDER BY created_at DESC");
        res.render("index.ejs", { books: result.rows});
    } catch (error) {
        console.error(error);
        res.render("index.ejs", {books: []});
    }
});

app.get("/books/new", (req, res) => { // load all posts
    res.render("new-book.ejs");
})

app.post("/books", async (req, res) => { // post new book review
    const title = req.body.title;
    const author = req.body.author;
    const review = req.body.review;
    // TODO: add review-exerpt parsing
    try {
        const { isbn, coverUrl, publicationYear } = await searchGoogleBooks(title, author); 

        if(!isbn) {
            res.render("new-book.ejs", {error: "Book not found. Try different search terms."});
            return;
        }

        const result = await db.query(
            "INSERT INTO booklist (book_title, book_author, book_isbn, cover_url, review, publication_year) VALUES ($1, $2, $3, $4, $5 $6) RETURNING *",
            [title, author, isbn, coverUrl, review, publicationYear]
        );
        res.redirect("/");
        } catch (error) {
            console.error("Error:", error);
            res.render("new-book.ejs", { error: "Something went wrong. Please try again."});
        }
});

app.get("/books/:id", async (req, res) => { // view book review
    try {
        const result = await db.query("SELECT * FROM booklist WHERE id = $1", [req.params.id]);
        const book = result.rows[0];

        if (!book) {
            res.status(404).send("Book not found.");
            return;
        }
        res.render("view-book.ejs", { book: book });
    } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
    }
});

app.get("/books/edit/:id", async (req, res) => { // edit book review
    try {
        const result = await db.query("SELECT * FROM booklist WHERE id = $1", [req.params.id]);
        const book = result.rows[0];

        if (!book) {
            res.status(404).send("Book not found");
            return;
        }

        res.render("edit-book.ejs", { book: book });
    } catch (error) {
        console.error(error);
        res.status(500).send("Server error"); 
    }
});

app.post("/books/edit/:id", async (req, res) => { // update book review
    try {
        const { title, author, review } = req.body;
        const bookId = req.params.id; // id comes from URL not from body
        const result = await db.query(
            "UPDATE booklist SET book_title = $1, book_author = $2, review = $3 WHERE id = $4", 
            [title, author, review, bookId]
        );

        res.redirect(`/books/${bookId}`); // redirect back to the book's view page
    } catch (error) {
        console.error(error);

        const book = {
            id: req.params.id,
            book_title: req.body.title,
            book_author: req.body.author,
            review: req.body.review
        };

        res.render("edit-book.ejs", {
            book: book,
            error: "Error saving changes. Please try again."
        });
    }
});

app.post("/books/delete/:id", async (req, res) => {
    try {
        const bookId = req.params.id;
        await db.query("DELETE FROM booklist WHERE id = $1", [bookId]); 
        res.redirect("/"); 
    } catch (error) {
        console.error(error);
        res.status(500).send("Error deleting book");
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });