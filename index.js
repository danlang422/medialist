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
        imageUrl: coverUrl,
        year: publicationYear
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
        imageUrl: posterUrl,
        year: releaseYear
    };
}

app.get("/", async (req, res) => {
    try {
        const result = await db.query("SELECT * FROM media ORDER BY created_at DESC");
        res.render("index.ejs", { items: result.rows});
    } catch (error) {
        console.error(error);
        res.render("index.ejs", {items: []});
    }
});

app.get("/media/new", (req, res) => {
    res.render("new-media.ejs");
})

app.post("/media", async (req, res) => {
    const title = req.body.title;
    const creator = req.body.creator;
    const review = req.body.review;
    const mediaType = req.body.media_type;

    try {
        let imageUrl = '';
        let year = '';

        if (mediaType === 'book') {
            const apiResult = await searchGoogleBooks(title, creator);
            imageUrl = apiResult.imageUrl;
            year = apiResult.year;

            if (!imageUrl) {
                res.render("new-media.ejs", {error: "Book not found. Try different search terms."});
                return;
            }
        } else if (mediaType === 'movie') {
            const apiResult = await searchTMDBMovie(title);
            imageUrl = apiResult.imageUrl;
            year = apiResult.year;

            if (!imageUrl) {
                res.render("new-media.ejs", {error: "Movie not found. Try different search terms."});
                return;
            }
        }

        const result = await db.query(
            "INSERT INTO media (title, creator, year, image_url, review, media_type) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
            [title, creator, year, imageUrl, review, mediaType]
        );
        res.redirect("/");
    } catch (error) {
        console.error("Error:", error);
        res.render("new-media.ejs", { error: "Something went wrong. Please try again."});
    }
});

app.get("/media/:id", async (req, res) => {
    try {
        const result = await db.query("SELECT * FROM media WHERE id = $1", [req.params.id]);
        const item = result.rows[0];

        if (!item) {
            res.status(404).send("Media not found.");
            return;
        }
        res.render("view-media.ejs", { item: item });
    } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
    }
});

app.get("/media/edit/:id", async (req, res) => {
    try {
        const result = await db.query("SELECT * FROM media WHERE id = $1", [req.params.id]);
        const item = result.rows[0];

        if (!item) {
            res.status(404).send("Media not found");
            return;
        }

        res.render("edit-media.ejs", { item: item });
    } catch (error) {
        console.error(error);
        res.status(500).send("Server error");
    }
});

app.post("/media/edit/:id", async (req, res) => {
    try {
        const { title, creator, review } = req.body;
        const itemId = req.params.id;
        const result = await db.query(
            "UPDATE media SET title = $1, creator = $2, review = $3 WHERE id = $4",
            [title, creator, review, itemId]
        );

        res.redirect(`/media/${itemId}`);
    } catch (error) {
        console.error(error);

        const item = {
            id: req.params.id,
            title: req.body.title,
            creator: req.body.creator,
            review: req.body.review
        };

        res.render("edit-media.ejs", {
            item: item,
            error: "Error saving changes. Please try again."
        });
    }
});

app.post("/media/delete/:id", async (req, res) => {
    try {
        const itemId = req.params.id;
        await db.query("DELETE FROM media WHERE id = $1", [itemId]);
        res.redirect("/");
    } catch (error) {
        console.error(error);
        res.status(500).send("Error deleting media");
    }
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });