document.addEventListener('DOMContentLoaded', () => {
    const scrapeButton = document.getElementById('scrapeButton');
    const searchInput = document.getElementById('searchInput');
    const jobsList = document.getElementById('jobsList');
    const statusLogs = document.getElementById('statusLogs'); // Already exists in HTML

    // Load jobs when page loads
    loadJobs();

    // Scrape new jobs
    scrapeButton.addEventListener('click', async () => {
        scrapeButton.classList.add('loading');
        scrapeButton.disabled = true;
        
        try {
            const response = await fetch('/scrape');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            
            if (data.error) {
                showNotification(data.error, 'error');
            } else {
                showNotification(`Successfully added ${data.count} new jobs!`, 'success');
                loadJobs(); // Refresh the jobs list
            }
        } catch (error) {
            console.error('Error:', error);
            showNotification('Failed to update jobs: ' + error.message, 'error');
        } finally {
            scrapeButton.classList.remove('loading');
            scrapeButton.disabled = false;
        }
    });

    // Search jobs
    let debounceTimeout;
    searchInput.addEventListener('input', () => {
        clearTimeout(debounceTimeout);
        debounceTimeout = setTimeout(() => {
            loadJobs(searchInput.value);
        }, 300);
    });

    // Add pagination event listeners
    const pagination = document.getElementById('pagination');
    pagination.querySelector('.prev-page').addEventListener('click', () => {
        const currentPage = parseInt(pagination.dataset.currentPage) || 1;
        if (currentPage > 1) {
            loadJobs(searchInput.value, currentPage - 1);
        }
    });

    pagination.querySelector('.next-page').addEventListener('click', () => {
        const currentPage = parseInt(pagination.dataset.currentPage) || 1;
        const totalPages = parseInt(pagination.dataset.totalPages) || 1;
        if (currentPage < totalPages) {
            loadJobs(searchInput.value, currentPage + 1);
        }
    });

    async function loadJobs(search = '', page = 1) {
        try {
            const response = await fetch(`/api/jobs?search=${search}&page=${page}`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            
            displayJobs(data.jobs);
            updatePagination(data.pagination);
            
            // Update total jobs count
            document.getElementById('totalJobs').textContent = data.pagination.total;
            document.getElementById('jobsCount').textContent = `${data.jobs.length} of ${data.pagination.total} jobs`;
        } catch (error) {
            console.error('Error loading jobs:', error);
            showNotification('Error loading jobs: ' + error.message, 'error');
        }
    }

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

    function displayJobs(jobs) {
        // Add sort controls if not already present
        if (!document.querySelector('.sort-controls')) {
            const sortControls = document.createElement('div');
            sortControls.className = 'sort-controls';
            sortControls.innerHTML = `
                <select id="sortSelect" onchange="sortJobs(this.value)">
                    <option value="date-desc">Newest First</option>
                    <option value="date-asc">Oldest First</option>
                    <option value="company">Company Name</option>
                    <option value="title">Job Title</option>
                </select>
            `;
            jobsList.parentNode.insertBefore(sortControls, jobsList);
        }

        jobsList.innerHTML = jobs.map(job => {
            const truncatedDescription = job.snippet.length > 300 
                ? job.snippet.substring(0, 300).trim() + '...' 
                : job.snippet;

            const isRecent = new Date(job.published_date) > new Date(Date.now() - 86400000 * 2); // 2 days

            return `
                <div class="job-card ${isRecent ? 'recent' : ''}">
                    <div class="job-header">
                        <h2>${job.title}</h2>
                        <div class="company-info">
                            <span class="company-name">${job.company_name}</span>
                            ${job.location ? `<span class="location">📍 ${job.location}</span>` : ''}
                        </div>
                    </div>
                    
                    <div class="job-details">
                        ${job.job_type ? `<span class="tag job-type">${job.job_type}</span>` : ''}
                        ${job.salary_range ? `<span class="tag salary">💰 ${job.salary_range}</span>` : ''}
                        ${isRecent ? '<span class="tag recent">New</span>' : ''}
                    </div>

                    <div class="job-description-container">
                        <p class="job-description">${truncatedDescription}</p>
                        <a href="${job.link}" target="_blank" class="see-more">See More ›</a>
                    </div>
                    
                    <div class="job-meta">
                        <div class="job-links">
                            <a href="${job.link}" target="_blank" class="apply-btn">Apply Now</a>
                            <a href="${job.link}" target="_blank" class="company-link">${job.displayLink}</a>
                        </div>
                        ${job.published_date ? `
                            <span class="job-date" title="${new Date(job.published_date).toLocaleDateString()}">
                                ${timeAgo(job.published_date)}
                            </span>
                        ` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    function updatePagination(pagination) {
        const paginationEl = document.getElementById('pagination');
        const prevButton = paginationEl.querySelector('.prev-page');
        const nextButton = paginationEl.querySelector('.next-page');
        const pageNumbers = paginationEl.querySelector('.page-numbers');
        
        // Store current state in dataset for button handlers
        paginationEl.dataset.currentPage = pagination.currentPage;
        paginationEl.dataset.totalPages = pagination.totalPages;
        
        prevButton.disabled = !pagination.hasPrev;
        nextButton.disabled = !pagination.hasNext;
        
        // Update page numbers
        pageNumbers.innerHTML = `Page ${pagination.currentPage} of ${pagination.totalPages}`;
    }

    function showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.classList.add('fade-out');
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    function sortJobs(sortBy) {
        const currentJobs = Array.from(document.querySelectorAll('.job-card'));
        const sortedJobs = currentJobs.sort((a, b) => {
            switch (sortBy) {
                case 'date-desc':
                    return new Date(b.querySelector('.job-date').title) - new Date(a.querySelector('.job-date').title);
                case 'date-asc':
                    return new Date(a.querySelector('.job-date').title) - new Date(b.querySelector('.job-date').title);
                case 'company':
                    return a.querySelector('.company-name').textContent.localeCompare(b.querySelector('.company-name').textContent);
                case 'title':
                    return a.querySelector('h2').textContent.localeCompare(b.querySelector('h2').textContent);
                default:
                    return 0;
            }
        });
        
        jobsList.innerHTML = '';
        sortedJobs.forEach(job => jobsList.appendChild(job));
    }

    // Add this function to update stats
    async function updateStats() {
        try {
            const response = await fetch('/api/stats');
            const stats = await response.json();
            
            document.getElementById('totalJobs').textContent = stats.total;
            document.getElementById('newJobs').textContent = stats.newToday;
            document.getElementById('companies').textContent = stats.uniqueCompanies;
            document.getElementById('activeJobs').textContent = stats.active;
        } catch (error) {
            console.error('Error updating stats:', error);
        }
    }

    // Call updateStats when page loads and after scraping
    updateStats();
}); 