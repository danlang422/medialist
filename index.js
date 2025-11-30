import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import 'dotenv/config';

const app = express();
const port = 3000;

const pgPassword = process.env.DB_PASSWORD;

const db = new pg.Client({
    connectionString: process.env.DATABASE_URL || `postgresql://postgres:${pgPassword}@localhost:5432/medialist`,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
  });

db.connect();

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public")); 
app.use((req, res, next) => {
    res.locals.currentFilter = req.query.filter || 'all';
    next();
});

async function searchGoogleBooks(title, author) {
    const searchQuery = `${title} ${author}`;
    const encodedQuery = encodeURIComponent(searchQuery);
    const googleApiURL = `https://www.googleapis.com/books/v1/volumes?q=${encodedQuery}`;

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
    const tmdbApiUrl = `https://api.themoviedb.org/3/search/movie?api_key=${tmdbApiKey}&query=${encodedQuery}`;

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

async function searchTMDBTV(title) {
    const searchQuery = `${title}`;
    const encodedQuery = encodeURIComponent(searchQuery);
    const tmdbApiKey = process.env.TMDB_API_KEY;
    const tmdbApiUrl = `https://api.themoviedb.org/3/search/tv?api_key=${tmdbApiKey}&query=${encodedQuery}`;

    const response = await fetch(tmdbApiUrl);
    const data = await response.json();

    const tmdbImageBase = 'https://image.tmdb.org/t/p/w500/';
    const posterPath = data.results?.[0]?.poster_path;
    const posterUrl = posterPath ? tmdbImageBase + posterPath : '';
    const firstAirDate = data.results?.[0]?.first_air_date;
    const releaseYear = firstAirDate ? firstAirDate.split('-')[0] : '';

    return {
        imageUrl: posterUrl,
        year: releaseYear
    };
}

async function searchRAWGGame(title) {
    const encodedQuery = encodeURIComponent(title);
    const rawgApiKey = process.env.RAWG_API_KEY;
    const rawgApiUrl = `https://api.rawg.io/api/games?key=${rawgApiKey}&search=${encodedQuery}`;

    const response = await fetch(rawgApiUrl);
    const data = await response.json();

    const game = data.results?.[0];
    
    if (!game) {
        return { imageUrl: '', year: '' };
    }

    const imageUrl = game.background_image || ''; // High quality cover image
    const releaseDate = game.released;
    const year = releaseDate ? releaseDate.split('-')[0] : '';

    return {
        imageUrl: imageUrl,
        year: year
    };
}

async function searchLastFMMusic(title, artist) {
    const encodedTitle = encodeURIComponent(title);
    const encodedArtist = encodeURIComponent(artist);
    const lastfmApiKey = process.env.LASTFM_API_KEY;
    
    // Search for the album
    const searchUrl = `https://ws.audioscrobbler.com/2.0/?method=album.search&album=${encodedTitle}&api_key=${lastfmApiKey}&format=json`;
    
    const response = await fetch(searchUrl);
    const data = await response.json();
    
    const album = data.results?.albummatches?.album?.[0];
    
    if (!album) {
        return { imageUrl: '', year: '' };
    }
    
    // Get the largest image available
    const images = album.image;
    const largeImage = images?.find(img => img.size === 'extralarge');
    const imageUrl = largeImage?.['#text'] || '';
    
    // Last.fm doesn't always have release year in search results
    // We'd need to make a second API call to get it, but let's start simple
    const year = '';
    
    return {
        imageUrl: imageUrl,
        year: year
    };
}

app.get("/", async (req, res) => {
    try {
        const filter = req.query.filter; // Gets 'book', 'movie', 'all', or undefined

        // Start building SQL query
        let query = "SELECT * FROM media";
        let params = [];

        if (filter && filter !=='all') {
            query += " WHERE media_type = $1";
            params.push(filter);
        }

        // Always order by most recent
        query += " ORDER BY created_at DESC";

        // Execute query
        const result = await db.query(query, params);

        // Pass both items and the current filter to the template
        res.render("index.ejs", {
            items: result.rows,
            currentFilter: filter || 'all' // default to 'all' if no filter
        });
    } catch (error) {
        res.render("index.ejs", {
            items: [],
            currentFilter: 'all'
        });
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
        } else if (mediaType === 'tv') {
            const apiResult = await searchTMDBTV(title);
            imageUrl = apiResult.imageUrl;
            year = apiResult.year;
        
            if (!imageUrl) {
                res.render("new-media.ejs", {error: "TV show not found. Try different search terms."});
                return;
            }
        } else if (mediaType === 'game') {
            const apiResult = await searchRAWGGame(title);
            imageUrl = apiResult.imageUrl;
            year = apiResult.year;
        
            if (!imageUrl) {
                res.render("new-media.ejs", {error: "Game not found. Try different search terms."});
                return;
            }
        } else if (mediaType === 'music') {
            const apiResult = await searchLastFMMusic(title, creator);
            imageUrl = apiResult.imageUrl;
            year = apiResult.year;
        
            if (!imageUrl) {
                res.render("new-media.ejs", {error: "Album not found. Try different search terms."});
                return;
            }
        }

        const result = await db.query(
            "INSERT INTO media (title, creator, year, image_url, review, media_type) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
            [title, creator, year || null, imageUrl, review, mediaType]
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