// ============================================
// Internal Link Architect PRO - Application Logic
// ============================================

// DOM Elements
const form = document.getElementById('linkForm');
const processing = document.getElementById('processing');
const processingText = document.getElementById('processingText');
const results = document.getElementById('results');
const outputCode = document.getElementById('outputCode');
const copyBtn = document.getElementById('copyBtn');
const resetBtn = document.getElementById('resetBtn');
const sliderValue = document.getElementById('sliderValue');
const numLinksSlider = document.getElementById('numLinks');

// Stats elements
const statLinks = document.getElementById('statLinks');
const statCandidates = document.getElementById('statCandidates');
const statWords = document.getElementById('statWords');

// Update slider value display
numLinksSlider.addEventListener('input', (e) => {
    sliderValue.textContent = e.target.value;
});

// Form submission handler
form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const sitemapUrl = document.getElementById('sitemapUrl').value.trim();
    const blogUrl = document.getElementById('blogUrl').value.trim();
    const numLinks = parseInt(document.getElementById('numLinks').value);

    await processLinkInjection(sitemapUrl, blogUrl, numLinks);
});

// Copy to clipboard
copyBtn.addEventListener('click', () => {
    const htmlOutput = outputCode.textContent;
    navigator.clipboard.writeText(htmlOutput).then(() => {
        const originalText = copyBtn.textContent;
        copyBtn.textContent = '✅ Copied!';
        setTimeout(() => {
            copyBtn.textContent = originalText;
        }, 2000);
    });
});

// Reset button
resetBtn.addEventListener('click', () => {
    results.classList.remove('active');
    form.reset();
    sliderValue.textContent = '5';
});

// ============================================
// Main Processing Function
// ============================================
async function processLinkInjection(sitemapUrl, blogUrl, numLinks) {
    try {
        // Show processing animation
        processing.classList.add('active');
        results.classList.remove('active');

        // Step 1: Fetch sitemap
        updateProcessingText('📡 Fetching sitemap...');
        const candidateUrls = await fetchAndParseSitemap(sitemapUrl, blogUrl);

        // Step 2: Fetch blog post
        updateProcessingText('📄 Fetching blog post content...');
        const blogContent = await fetchBlogPost(blogUrl);

        // Step 3: Score relevance
        updateProcessingText('🧠 Analyzing relevance and scoring candidates...');
        const scoredCandidates = scoreRelevance(blogContent, candidateUrls, blogUrl);

        // Step 4: Select top candidates
        const topCandidates = scoredCandidates.slice(0, numLinks);

        // Step 5: Inject links
        updateProcessingText('🔗 Injecting internal links...');
        const htmlOutput = injectLinks(blogContent.html, topCandidates, numLinks);

        // Display results
        displayResults(htmlOutput, topCandidates.length, candidateUrls.length, blogContent.wordCount);

    } catch (error) {
        console.error('Error:', error);
        alert(`❌ Error: ${error.message}\n\nPlease check:\n- URLs are correct and accessible\n- Sitemap is valid XML\n- CORS is enabled on the server`);
        processing.classList.remove('active');
    }
}

// ============================================
// Fetch and Parse Sitemap (Handles Sitemap Index & Regular Sitemaps)
// ============================================
async function fetchAndParseSitemap(sitemapUrl, excludeUrl, visitedSitemaps = new Set()) {
    try {
        // Prevent infinite loops and excessive recursion
        if (visitedSitemaps.has(sitemapUrl) || visitedSitemaps.size > 20) return [];
        visitedSitemaps.add(sitemapUrl);

        updateProcessingText(`📡 Fetching: ${sitemapUrl.split('/').pop()}`);

        const response = await fetch(sitemapUrl);
        if (!response.ok) throw new Error(`Status ${response.status}`);

        const text = await response.text();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(text, 'text/xml');

        // Check for parsing errors
        const parserError = xmlDoc.querySelector('parsererror');
        if (parserError) throw new Error('Invalid XML');

        let allUrls = [];

        // CASE 1: Sitemap Index (contains other sitemaps)
        const sitemapElements = xmlDoc.querySelectorAll('sitemap > loc');
        if (sitemapElements.length > 0) {
            updateProcessingText(`📂 Sitemap Index detected...`);
            const subSitemapUrls = Array.from(sitemapElements).map(el => el.textContent.trim());
            
            // Limit the number of sub-sitemaps to process for performance
            // Usually we only care about 'post', 'page' or 'article' sitemaps
            const filteredSubSitemaps = subSitemapUrls.filter(url => 
                !url.includes('category') && !url.includes('tag') && !url.includes('author') && !url.includes('image')
            ).slice(0, 10); // Safety limit

            for (const subUrl of filteredSubSitemaps) {
                const subUrls = await fetchAndParseSitemap(subUrl, excludeUrl, visitedSitemaps);
                allUrls = allUrls.concat(subUrls);
            }
        }

        // CASE 2: Regular Sitemap (contains direct URLs)
        const urlElements = xmlDoc.querySelectorAll('url > loc');
        if (urlElements.length > 0) {
            const leafUrls = Array.from(urlElements)
                .map(el => el.textContent.trim())
                .filter(url => 
                    url !== excludeUrl && 
                    url !== excludeUrl + '/' && 
                    url + '/' !== excludeUrl &&
                    !url.endsWith('.xml') // Defensive check
                );
            allUrls = allUrls.concat(leafUrls);
        }

        // Final filtering and deduplication for the root call
        if (visitedSitemaps.size === 1 && allUrls.length === 0) {
            throw new Error('No URLs found in this sitemap structure.');
        }

        return [...new Set(allUrls)]; // Return unique URLs
    } catch (error) {
        console.warn(`Skipping sitemap ${sitemapUrl}: ${error.message}`);
        // If this was the root sitemap and it failed, throw error
        if (visitedSitemaps.size === 1) throw new Error(`Sitemap error: ${error.message}`);
        return [];
    }
}

// ============================================
// Fetch Blog Post Content
// ============================================
async function fetchBlogPost(blogUrl) {
    try {
        const response = await fetch(blogUrl);
        if (!response.ok) throw new Error(`Failed to fetch blog post: ${response.status}`);

        const html = await response.text();

        // Parse HTML
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Extract title
        const title = doc.querySelector('title')?.textContent || '';
        const h1 = doc.querySelector('h1')?.textContent || ''

            ;

        // Extract ONLY the main article content
        // Try multiple selectors to find the actual article content
        let article = doc.querySelector('article .ch-blog-text') ||
            doc.querySelector('.ch-blog-text') ||
            doc.querySelector('article') ||
            doc.querySelector('main') ||
            doc.querySelector('.post-content') ||
            doc.querySelector('.entry-content') ||
            doc.querySelector('[role="main"]');

        // If we found a container, clone it to manipulate without affecting original
        if (!article) article = doc.body;

        const articleClone = article.cloneNode(true);

        // Remove unwanted elements from the article content
        const unwantedSelectors = [
            'nav', 'header', 'footer', 'aside',
            '.navigation', '.nav', '.menu',
            '.sidebar', '.widget', '.comments',
            '.related-posts', '.share-buttons',
            'script', 'style', 'noscript',
            '.social-share', '.author-bio',
            'form', '.newsletter', '.subscription',
            '[class*="ad-"]', '[id*="ad-"]'
        ];

        unwantedSelectors.forEach(selector => {
            articleClone.querySelectorAll(selector).forEach(el => el.remove());
        });

        // Get the clean HTML content
        const contentHtml = articleClone.innerHTML;
        const textContent = articleClone.textContent || '';

        // Count words
        const wordCount = textContent.trim().split(/\s+/).length;

        return {
            html: contentHtml,
            title: title || h1,
            text: textContent,
            wordCount: wordCount,
            url: blogUrl
        };
    } catch (error) {
        throw new Error(`Blog post error: ${error.message}`);
    }
}

// ============================================
// Relevance Scoring Algorithm
// ============================================
function scoreRelevance(blogContent, candidateUrls, blogUrl) {
    const blogTitle = blogContent.title.toLowerCase();
    const blogText = blogContent.text.toLowerCase();
    const blogSlug = extractSlug(blogUrl);
    const blogKeywords = extractKeywords(blogText);

    const scored = candidateUrls.map(url => {
        const candidateSlug = extractSlug(url);
        const candidateTitle = slugToTitle(candidateSlug);

        // 1. Title/Slug Similarity (40%)
        const titleScore = calculateSimilarity(blogSlug, candidateSlug) * 0.4;

        // 2. Keyword Overlap (40%)
        const candidateKeywords = extractKeywords(candidateTitle);
        const keywordScore = calculateKeywordOverlap(blogKeywords, candidateKeywords) * 0.4;

        // 3. URL Structure Similarity (20%)
        const urlScore = calculateUrlStructureSimilarity(blogUrl, url) * 0.2;

        const totalScore = titleScore + keywordScore + urlScore;

        return {
            url: url,
            title: candidateTitle,
            score: totalScore
        };
    });

    // Sort by score descending
    return scored.sort((a, b) => b.score - a.score);
}

// Extract slug from URL
function extractSlug(url) {
    try {
        const urlObj = new URL(url);
        const pathname = urlObj.pathname;
        const parts = pathname.split('/').filter(p => p.length > 0);
        return parts[parts.length - 1] || '';
    } catch {
        return '';
    }
}

// Convert slug to readable title
function slugToTitle(slug) {
    return slug
        .replace(/[-_]/g, ' ')
        .replace(/\.(html|htm|php|asp|aspx)$/i, '')
        .trim();
}

// Extract meaningful keywords (skip common words)
function extractKeywords(text) {
    const stopWords = new Set([
        'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
        'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
        'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
        'should', 'could', 'may', 'might', 'must', 'can', 'this', 'that',
        'these', 'those', 'what', 'which', 'who', 'when', 'where', 'why', 'how'
    ]);

    const words = text.toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length > 3 && !stopWords.has(word));

    // Count word frequency
    const wordCount = {};
    words.forEach(word => {
        wordCount[word] = (wordCount[word] || 0) + 1;
    });

    // Return top keywords
    return Object.entries(wordCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([word]) => word);
}

// Calculate similarity between two strings using Jaccard similarity
function calculateSimilarity(str1, str2) {
    const set1 = new Set(str1.toLowerCase().split(/[\s-_]+/));
    const set2 = new Set(str2.toLowerCase().split(/[\s-_]+/));

    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    return union.size === 0 ? 0 : intersection.size / union.size;
}

// Calculate keyword overlap
function calculateKeywordOverlap(keywords1, keywords2) {
    const set1 = new Set(keywords1);
    const set2 = new Set(keywords2);

    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    return union.size === 0 ? 0 : intersection.size / union.size;
}

// Calculate URL structure similarity
function calculateUrlStructureSimilarity(url1, url2) {
    try {
        const path1 = new URL(url1).pathname.split('/').filter(p => p);
        const path2 = new URL(url2).pathname.split('/').filter(p => p);

        let matches = 0;
        const minLength = Math.min(path1.length, path2.length);

        for (let i = 0; i < minLength - 1; i++) { // Exclude last segment (slug)
            if (path1[i] === path2[i]) matches++;
        }

        return minLength > 1 ? matches / (minLength - 1) : 0;
    } catch {
        return 0;
    }
}

// ============================================
// Link Injection
// ============================================
function injectLinks(htmlContent, candidates, numLinks) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, 'text/html');

    // Find all paragraphs
    const paragraphs = Array.from(doc.querySelectorAll('p'));

    if (paragraphs.length === 0) {
        throw new Error('No paragraphs found in the blog post');
    }

    // Calculate insertion points (evenly distributed)
    const insertionIndices = calculateInsertionPoints(paragraphs.length, numLinks);

    // Inject links at calculated points
    insertionIndices.forEach((index, i) => {
        if (i < candidates.length) {
            const candidate = candidates[i];
            const newParagraph = createLinkParagraph(candidate, htmlContent);

            // Insert after the target paragraph
            if (paragraphs[index] && paragraphs[index].parentNode) {
                paragraphs[index].parentNode.insertBefore(newParagraph, paragraphs[index].nextSibling);
            }
        }
    });

    // Return only body content (no html, head tags)
    return doc.body.innerHTML;
}

// Calculate where to insert links (evenly distributed)
function calculateInsertionPoints(totalParagraphs, numLinks) {
    const points = [];
    const step = Math.floor(totalParagraphs / (numLinks + 1));

    for (let i = 1; i <= numLinks; i++) {
        const index = Math.min(step * i, totalParagraphs - 1);
        points.push(index);
    }

    return points;
}

// Create a new paragraph with internal link
function createLinkParagraph(candidate, context) {
    const p = document.createElement('p');

    // Generate more natural, varied transition sentences
    const transitions = generateEnhancedTransition(candidate.title);

    // Create clean HTML with embedded link
    p.innerHTML = `${transitions.intro} <a href="${candidate.url}">${formatAnchorText(candidate.title)}</a>${transitions.outro}`;

    return p;
}

// Generate enhanced natural transition text with intro and outro
function generateEnhancedTransition(title) {
    const patterns = [
        {
            intro: "When exploring this topic further, consider checking out our guide on",
            outro: " to see how it compares and what might work best for your needs."
        },
        {
            intro: "For those interested in related solutions, our comprehensive review of",
            outro: " provides valuable insights that might help inform your decision."
        },
        {
            intro: "If you're weighing your options, it's worth exploring",
            outro: " for a detailed comparison of features and capabilities."
        },
        {
            intro: "To deepen your understanding of this subject, take a look at our analysis on",
            outro: " which covers key aspects in more detail."
        },
        {
            intro: "Building on these concepts, you might find our guide to",
            outro: " particularly helpful for understanding the broader context."
        },
        {
            intro: "For additional perspective on similar tools and platforms, check out",
            outro: " to see alternative approaches and solutions."
        },
        {
            intro: "If you're evaluating different options, our detailed comparison of",
            outro: " offers insights that can guide your selection process."
        },
        {
            intro: "To explore related features and functionality, review our post on",
            outro: " for a comprehensive overview of what's available."
        },
        {
            intro: "For those considering alternatives, investigating",
            outro: " can provide clarity on different strengths and use cases."
        },
        {
            intro: "Understanding the full landscape requires looking at",
            outro: " to see how various solutions stack up against each other."
        }
    ];

    return patterns[Math.floor(Math.random() * patterns.length)];
}

// Legacy function kept for backward compatibility
function generateTransitionText(title) {
    return generateEnhancedTransition(title).intro;
}

// Format anchor text from title
function formatAnchorText(title) {
    // Clean and capitalize properly
    return title
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ')
        .substring(0, 60); // Limit length
}

// ============================================
// UI Helper Functions
// ============================================
function updateProcessingText(text) {
    processingText.textContent = text;
}

function displayResults(htmlOutput, linksInjected, candidatesAnalyzed, wordCount) {
    // Update stats
    statLinks.textContent = linksInjected;
    statCandidates.textContent = candidatesAnalyzed;
    statWords.textContent = wordCount.toLocaleString();

    // Display HTML output
    outputCode.textContent = htmlOutput;

    // Hide processing, show results
    processing.classList.remove('active');
    results.classList.add('active');

    // Scroll to results
    results.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
