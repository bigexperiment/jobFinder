const express = require('express');
const fetch = require('node-fetch');
require('dotenv').config(); // This is the correct way to load dotenv
const { initDatabase, saveJob, getJobs } = require('./database');
// const { JSDOM } = require('jsdom'); // Will use this later for Workday scraping

const app = express();
const port = 3000;

// Serve static files from public directory
app.use(express.static('public'));

// Initialize database when server starts
initDatabase();

// Constants for pagination
const MAX_RESULTS = 100; // Temporarily set to 10
const RESULTS_PER_PAGE = 10;

// Add this function to format job details for logging
function formatJobForLog(job, index) {
    return `${index + 1}. ${job.title} (${job.displayLink})`;
}

function extractPublishedDate(item) {
    try {
        // Try to get date from pagemap
        if (item.pagemap?.metatags?.[0]?.['article:published_time']) {
            return item.pagemap.metatags[0]['article:published_time'];
        }
        
        // Try to get date from pagemap jobposting
        if (item.pagemap?.jobposting?.[0]?.dateposted) {
            return item.pagemap.jobposting[0].dateposted;
        }

        // Try to get date from snippet (often contains dates)
        const dateMatch = item.snippet.match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4}/);
        if (dateMatch) {
            return new Date(dateMatch[0]).toISOString();
        }

        return null;
    } catch (error) {
        console.warn('Error extracting date:', error);
        return null;
    }
}

function isWorkdayJob(url) {
    return url.includes('myworkdayjobs.com') || url.includes('myworkday.com');
}

function extractJobDetails(item) {
    try {
        // Extract company name from title or displayLink
        let companyName = '';
        if (item.pagemap?.organization?.[0]?.name) {
            companyName = item.pagemap.organization[0].name;
        } else {
            // Try to extract from displayLink
            companyName = item.displayLink.split('.')[0]
                .replace('www', '')
                .replace('wd3', '')
                .replace('wd5', '')
                .replace('careers', '')
                .replace('jobs', '')
                .replace('myworkdayjobs', '')
                .replace('myworkday', '')
                .split('-').join(' ')
                .trim();
            // Capitalize first letter of each word
            companyName = companyName.split(' ')
                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                .join(' ');
        }

        // Try to extract location from snippet or title
        const locationRegex = /in\s([^,\.]+(?:,[^,\.]+)?)/i;
        const locationMatch = item.snippet.match(locationRegex) || item.title.match(locationRegex);
        const location = locationMatch ? locationMatch[1].trim() : '';

        // Try to extract job type
        const jobTypeRegex = /(Full[- ]Time|Part[- ]Time|Contract|Remote|Hybrid)/i;
        const jobTypeMatch = item.snippet.match(jobTypeRegex) || item.title.match(jobTypeRegex);
        const jobType = jobTypeMatch ? jobTypeMatch[1].trim() : '';

        // Try to extract salary range
        const salaryRegex = /\$[\d,]+ *[-–] *\$[\d,]+|\$[\d,]+ *[+]/;
        const salaryMatch = item.snippet.match(salaryRegex);
        const salaryRange = salaryMatch ? salaryMatch[0] : '';

        // Extract workday URL if present
        const workdayUrl = item.link.includes('workday') ? item.link : null;

        return {
            companyName,
            location,
            jobType,
            salaryRange,
            workdayUrl
        };
    } catch (error) {
        console.warn('Error extracting job details:', error);
        return {
            companyName: '',
            location: '',
            jobType: '',
            salaryRange: '',
            workdayUrl: null
        };
    }
}

// Remove Gemini-related code and simplify job scraping
async function scrapeWorkdayJobDetails(url) {
    try {
        const response = await fetch(url);
        const html = await response.text();

        // Extract data from meta tags and JSON-LD
        const titleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i);
        const descriptionMatch = html.match(/<meta\s+property="og:description"\s+content="([^"]+)"/i);
        
        // Get JSON-LD data which often contains more structured information
        const jsonLdMatch = html.match(/<script\s+type="application\/ld\+json">([^<]+)<\/script>/i);
        let jsonLdData = null;
        if (jsonLdMatch) {
            try {
                jsonLdData = JSON.parse(jsonLdMatch[1]);
                console.log('Extracted job data:', {
                    title: jsonLdData.title,
                    location: jsonLdData.jobLocation?.address?.addressLocality,
                    employmentType: jsonLdData.employmentType,
                    datePosted: jsonLdData.datePosted,
                    organization: jsonLdData.hiringOrganization?.name,
                    identifier: jsonLdData.identifier?.value
                });
            } catch (e) {
                console.error('Error parsing JSON-LD:', e);
            }
        }

        // Extract salary range from description if exists
        const salaryRegex = /\$[\d,]+ *[-–] *\$[\d,]+|\$[\d,]+ *[+]/;
        const salaryMatch = jsonLdData?.description?.match(salaryRegex);
        
        return {
            scrapedTitle: jsonLdData?.title || titleMatch?.[1] || null,
            scrapedDescription: jsonLdData?.description || descriptionMatch?.[1] || null,
            scrapedLocation: jsonLdData?.jobLocation?.address?.addressLocality || null,
            scrapedEmploymentType: jsonLdData?.employmentType || null,
            scrapedOrganization: jsonLdData?.hiringOrganization?.name || null,
            scrapedSalary: salaryMatch?.[0] || null,
            scrapedDatePosted: jsonLdData?.datePosted || null,
            scrapedJobId: jsonLdData?.identifier?.value || null,
            workdayUrl: url
        };

    } catch (error) {
        console.error('Error scraping Workday job:', error);
        return null;
    }
}

// Endpoint to trigger job scraping
app.get('/scrape', async (req, res) => {
    try {
        let allResults = [];
        const initialResult = await getJobs('', 1, 1000); // Get all jobs for counting
        const initialCount = initialResult.pagination.total;
        
        // Calculate how many pages we need to fetch (10 results per page from Google API)
        const numPages = Math.ceil(MAX_RESULTS / 10);
        console.log(`Fetching ${numPages} pages of results...`);

        // Fetch all pages
        for (let i = 0; i < numPages; i++) {
            const startIndex = i * 10 + 1; // Google's pagination starts at 1
            const apiUrl = `https://www.googleapis.com/customsearch/v1?key=${process.env.GOOGLE_API_KEY}&cx=e180cd071c7b94b1c&q=java+developer+jobs&start=${startIndex}`;
            
            console.log(`\nFetching page ${i + 1}/${numPages} from Google API...`);
            const response = await fetch(apiUrl);
            const data = await response.json();

            if (data.error) {
                console.error('Google API Error:', data.error);
                // Continue with next page if one fails
                continue;
            }

            if (!data.items || data.items.length === 0) {
                console.log(`No results on page ${i + 1}`);
                break; // No more results available
            }

            allResults = allResults.concat(data.items);
            console.log(`Found ${data.items.length} jobs on page ${i + 1}`);
            
            // Add a small delay between requests to avoid rate limiting
            if (i < numPages - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        console.log(`\nTotal jobs found: ${allResults.length}`);

        // Save jobs to database with progress tracking
        let savedCount = 0;
        const savePromises = allResults.map(async (item, index) => {
            try {
                const publishedDate = extractPublishedDate(item);
                const jobDetails = extractJobDetails(item);
                
                if (isWorkdayJob(item.link)) {
                    const workdayDetails = await scrapeWorkdayJobDetails(item.link);
                    if (workdayDetails) {
                        await saveJob({
                            title: workdayDetails.scrapedTitle || item.title,
                            companyName: workdayDetails.scrapedOrganization || jobDetails.companyName,
                            location: workdayDetails.scrapedLocation || jobDetails.location,
                            jobType: workdayDetails.scrapedEmploymentType || jobDetails.jobType,
                            salaryRange: workdayDetails.scrapedSalary || jobDetails.salaryRange,
                            link: item.link,
                            workdayUrl: workdayDetails.workdayUrl,
                            displayLink: item.displayLink,
                            snippet: workdayDetails.scrapedDescription || item.snippet,
                            publishedDate: workdayDetails.scrapedDatePosted || publishedDate
                        });
                        savedCount++;
                        return;
                    }
                }
                
                await saveJob({
                    title: item.title,
                    ...jobDetails,
                    link: item.link,
                    displayLink: item.displayLink,
                    snippet: item.snippet,
                    publishedDate: publishedDate
                });
                savedCount++;

                // Log progress every 10 jobs
                if (savedCount % 10 === 0) {
                    console.log(`Saved ${savedCount}/${allResults.length} jobs...`);
                }
            } catch (error) {
                console.error(`Error saving job ${index + 1}:`, error);
            }
        });

        await Promise.all(savePromises);
        
        // Get final count after scraping
        const finalResult = await getJobs('', 1, 1000);
        const finalCount = finalResult.pagination.total;
        const newJobsCount = finalCount - initialCount;
        
        console.log('\nScraping completed:');
        console.log(`- Total jobs found: ${allResults.length}`);
        console.log(`- New jobs added: ${newJobsCount}`);
        console.log(`- Total jobs in database: ${finalCount}`);
        
        res.json({ 
            message: 'Jobs scraped and saved successfully',
            count: newJobsCount,
            totalFound: allResults.length,
            totalInDB: finalCount
        });

    } catch (error) {
        console.error('Scraping error:', error);
        res.status(500).json({ 
            error: 'Failed to scrape jobs',
            details: error.message 
        });
    }
});

// Update the endpoint to get saved jobs with pagination
app.get('/api/jobs', async (req, res) => {
    try {
        const searchTerm = req.query.search || '';
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || RESULTS_PER_PAGE;
        
        // Get paginated jobs from database
        const result = await getJobs(searchTerm, page, limit);
        res.json(result); // This will include both jobs and pagination info
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update the admin endpoint with better date formatting and sorting
app.get('/admin', async (req, res) => {
    try {
        const jobs = await getJobs();
        res.send(`
            <html>
                <head>
                    <title>Jobs Database Admin</title>
                    <style>
                        body { font-family: 'Inter', sans-serif; margin: 0; padding: 20px; background: #f5f7fa; }
                        .container { max-width: 1200px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
                        h1 { color: #2557a7; margin-bottom: 20px; }
                        table { border-collapse: collapse; width: 100%; margin-top: 20px; }
                        th, td { border: 1px solid #eee; padding: 12px; text-align: left; }
                        th { background-color: #f8f9fa; font-weight: 600; color: #444; }
                        tr:nth-child(even) { background-color: #fafbfc; }
                        tr:hover { background-color: #f5f7fa; }
                        .date { color: #666; }
                        .controls { margin-bottom: 20px; display: flex; gap: 10px; }
                        select { padding: 8px; border-radius: 4px; border: 1px solid #ddd; }
                        .badge { padding: 4px 8px; border-radius: 4px; font-size: 0.85em; }
                        .badge.recent { background: #e3f2fd; color: #1976d2; }
                        .badge.old { background: #fafafa; color: #666; }
                    </style>
                    <script>
                        function timeAgo(date) {
                            const seconds = Math.floor((new Date() - new Date(date)) / 1000);
                            let interval = seconds / 31536000;
                            
                            if (interval > 1) return Math.floor(interval) + ' years ago';
                            interval = seconds / 2592000;
                            if (interval > 1) return Math.floor(interval) + ' months ago';
                            interval = seconds / 86400;
                            if (interval > 1) return Math.floor(interval) + ' days ago';
                            interval = seconds / 3600;
                            if (interval > 1) return Math.floor(interval) + ' hours ago';
                            interval = seconds / 60;
                            if (interval > 1) return Math.floor(interval) + ' minutes ago';
                            return Math.floor(seconds) + ' seconds ago';
                        }

                        function sortTable(column) {
                            const table = document.querySelector('table');
                            const rows = Array.from(table.querySelectorAll('tr:not(:first-child)'));
                            const sortOrder = table.dataset.sortOrder === 'asc' ? 'desc' : 'asc';
                            table.dataset.sortOrder = sortOrder;

                            rows.sort((a, b) => {
                                let aVal = a.children[column].innerText;
                                let bVal = b.children[column].innerText;
                                
                                if (column === 0) { // ID column
                                    return sortOrder === 'asc' 
                                        ? parseInt(aVal) - parseInt(bVal)
                                        : parseInt(bVal) - parseInt(aVal);
                                }
                                
                                if (column === 5) { // Date column
                                    aVal = new Date(a.children[column].dataset.date);
                                    bVal = new Date(b.children[column].dataset.date);
                                }
                                
                                return sortOrder === 'asc' 
                                    ? aVal > bVal ? 1 : -1
                                    : bVal > aVal ? 1 : -1;
                            });

                            rows.forEach(row => table.appendChild(row));
                        }

                        window.onload = function() {
                            // Update relative times
                            document.querySelectorAll('.date').forEach(el => {
                                const date = el.dataset.date;
                                el.textContent = timeAgo(date);
                            });
                        }
                    </script>
                </head>
                <body>
                    <div class="container">
                        <h1>Jobs Database (${jobs.length} records)</h1>
                        <div class="controls">
                            <select onchange="sortTable(this.value)">
                                <option value="">Sort by...</option>
                                <option value="5">Date Posted</option>
                                <option value="2">Title</option>
                                <option value="3">Company</option>
                            </select>
                        </div>
                        <table data-sort-order="asc">
                            <tr>
                                <th onclick="sortTable(0)">ID</th>
                                <th onclick="sortTable(1)">Serial</th>
                                <th onclick="sortTable(2)">Title</th>
                                <th onclick="sortTable(3)">Company</th>
                                <th onclick="sortTable(4)">Location</th>
                                <th onclick="sortTable(5)">Posted</th>
                            </tr>
                            ${jobs.map(job => {
                                const isRecent = new Date(job.published_date) > new Date(Date.now() - 86400000 * 2); // 2 days
                                return `
                                    <tr>
                                        <td>${job.id}</td>
                                        <td>${job.job_serial}</td>
                                        <td>${job.title}</td>
                                        <td>${job.company_name}</td>
                                        <td>${job.location}</td>
                                        <td class="date" data-date="${job.published_date}">
                                            ${job.published_date}
                                            ${isRecent ? '<span class="badge recent">New</span>' : ''}
                                        </td>
                                    </tr>
                                `;
                            }).join('')}
                        </table>
                    </div>
                </body>
            </html>
        `);
    } catch (error) {
        res.status(500).send('Error loading database: ' + error.message);
    }
});

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
}); 