const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('jobs.db');

// Initialize database
function initDatabase() {
    db.run(`
        CREATE TABLE IF NOT EXISTS jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            job_serial TEXT UNIQUE,
            title TEXT,
            company_name TEXT,
            location TEXT,
            job_type TEXT,
            salary_range TEXT,
            link TEXT UNIQUE,
            workday_url TEXT UNIQUE,
            displayLink TEXT,
            snippet TEXT,
            published_date TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
}

// Save job to database
function saveJob(job) {
    return new Promise((resolve, reject) => {
        const { 
            title, 
            companyName,
            location,
            jobType,
            salaryRange,
            link, 
            workdayUrl,
            displayLink, 
            snippet, 
            publishedDate 
        } = job;

        // Generate job serial (e.g., JOB-2024-0001)
        const date = new Date();
        const yearMonth = date.getFullYear();
        
        // Get the next serial number
        db.get(
            "SELECT MAX(CAST(SUBSTR(job_serial, -4) AS INTEGER)) as max_serial FROM jobs WHERE job_serial LIKE ?",
            [`JOB-${yearMonth}-%`],
            (err, row) => {
                if (err) {
                    reject(err);
                    return;
                }

                const nextSerial = (row.max_serial || 0) + 1;
                const jobSerial = `JOB-${yearMonth}-${String(nextSerial).padStart(4, '0')}`;

                db.run(
                    `INSERT OR IGNORE INTO jobs (
                        job_serial, title, company_name, location, job_type, 
                        salary_range, link, workday_url, displayLink, 
                        snippet, published_date
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        jobSerial, title, companyName, location, jobType,
                        salaryRange, link, workdayUrl, displayLink,
                        snippet, publishedDate
                    ],
                    (err) => {
                        if (err) reject(err);
                        else resolve();
                    }
                );
            }
        );
    });
}

// Get all jobs with optional search
function getJobs(searchTerm = '', page = 1, limit = 10) {
    return new Promise((resolve, reject) => {
        const offset = (page - 1) * limit;
        
        // First get total count for pagination
        const countQuery = searchTerm
            ? `SELECT COUNT(*) as total FROM jobs WHERE title LIKE ? OR company_name LIKE ? OR location LIKE ?`
            : `SELECT COUNT(*) as total FROM jobs`;
        
        const searchPattern = `%${searchTerm}%`;
        const countParams = searchTerm ? [searchPattern, searchPattern, searchPattern] : [];
        
        db.get(countQuery, countParams, (err, row) => {
            if (err) {
                reject(err);
                return;
            }

            const total = row.total;
            const totalPages = Math.ceil(total / limit);

            // Then get paginated results
            const query = searchTerm
                ? `SELECT * FROM jobs 
                   WHERE title LIKE ? OR company_name LIKE ? OR location LIKE ? 
                   ORDER BY published_date DESC, created_at DESC 
                   LIMIT ? OFFSET ?`
                : `SELECT * FROM jobs 
                   ORDER BY published_date DESC, created_at DESC 
                   LIMIT ? OFFSET ?`;
            
            const queryParams = searchTerm 
                ? [searchPattern, searchPattern, searchPattern, limit, offset]
                : [limit, offset];

            db.all(query, queryParams, (err, rows) => {
                if (err) reject(err);
                else resolve({
                    jobs: rows,
                    pagination: {
                        total,
                        totalPages,
                        currentPage: page,
                        hasNext: page < totalPages,
                        hasPrev: page > 1,
                        limit
                    }
                });
            });
        });
    });
}

module.exports = { initDatabase, saveJob, getJobs }; 