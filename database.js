const { sql } = require('@vercel/postgres');

async function initDatabase() {
    try {
        // Create jobs table if it doesn't exist
        await sql`
            CREATE TABLE IF NOT EXISTS jobs (
                id SERIAL PRIMARY KEY,
                title TEXT NOT NULL,
                company_name TEXT,
                location TEXT,
                job_type TEXT,
                salary_range TEXT,
                link TEXT UNIQUE,
                workday_url TEXT,
                display_link TEXT,
                snippet TEXT,
                published_date TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `;
        console.log('Database initialized');
    } catch (error) {
        console.error('Error initializing database:', error);
    }
}

async function saveJob(job) {
    try {
        await sql`
            INSERT INTO jobs (
                title, company_name, location, job_type, 
                salary_range, link, workday_url, display_link, 
                snippet, published_date
            ) 
            VALUES (
                ${job.title}, ${job.companyName}, ${job.location}, ${job.jobType},
                ${job.salaryRange}, ${job.link}, ${job.workdayUrl}, ${job.displayLink},
                ${job.snippet}, ${job.publishedDate}
            )
            ON CONFLICT (link) DO NOTHING;
        `;
    } catch (error) {
        console.error('Error saving job:', error);
        throw error;
    }
}

async function getJobs(searchTerm = '', page = 1, limit = 10) {
    try {
        const offset = (page - 1) * limit;
        
        // Get total count
        let totalResult;
        if (searchTerm) {
            totalResult = await sql`
                SELECT COUNT(*) as total 
                FROM jobs 
                WHERE title ILIKE ${`%${searchTerm}%`} 
                   OR company_name ILIKE ${`%${searchTerm}%`} 
                   OR location ILIKE ${`%${searchTerm}%`}
            `;
        } else {
            totalResult = await sql`SELECT COUNT(*) as total FROM jobs`;
        }
        
        const total = totalResult.rows[0].total;
        const totalPages = Math.ceil(total / limit);

        // Get paginated results
        let jobs;
        if (searchTerm) {
            jobs = await sql`
                SELECT * FROM jobs 
                WHERE title ILIKE ${`%${searchTerm}%`} 
                   OR company_name ILIKE ${`%${searchTerm}%`} 
                   OR location ILIKE ${`%${searchTerm}%`}
                ORDER BY published_date DESC, created_at DESC 
                LIMIT ${limit} OFFSET ${offset}
            `;
        } else {
            jobs = await sql`
                SELECT * FROM jobs 
                ORDER BY published_date DESC, created_at DESC 
                LIMIT ${limit} OFFSET ${offset}
            `;
        }

        return {
            jobs: jobs.rows,
            pagination: {
                total,
                totalPages,
                currentPage: page,
                hasNext: page < totalPages,
                hasPrev: page > 1,
                limit
            }
        };
    } catch (error) {
        console.error('Error getting jobs:', error);
        throw error;
    }
}

module.exports = {
    initDatabase,
    saveJob,
    getJobs
}; 