import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { Pie, Line } from 'react-chartjs-2';
import 'chart.js/auto'; // Automatically registers required Chart.js components
import './App.css';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import CalendarHeatmap from 'react-calendar-heatmap';
import 'react-calendar-heatmap/dist/styles.css';
import { Tooltip } from 'react-tooltip';
import 'react-tooltip/dist/react-tooltip.css';
import * as tf from '@tensorflow/tfjs';
import * as cheerio from 'cheerio';
import stringSimilarity from 'string-similarity';

// Add these utility functions at the top, after imports
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const fetchWithRetry = async (url, options = {}, retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await axios(url, {
        ...options,
        timeout: 10000 // 10 second timeout
      });
      await delay(1500);
      return response;
    } catch (error) {
      console.error(`Attempt ${i + 1} failed:`, error.message);
      if (i === retries - 1) throw error;
      await delay(2000 * Math.pow(2, i));
    }
  }
};

// Define radiology subdomains and their related keywords
const radiologySubdomains = {
  'Neuroradiology': ['brain', 'neurological', 'spine', 'head', 'neck', 'neural', 'neuro'],
  'Chest/Cardiac': ['chest', 'lung', 'cardiac', 'heart', 'thoracic', 'pulmonary', 'cardiovascular'],
  'Abdominal': ['abdomen', 'liver', 'pancreas', 'gastrointestinal', 'gi', 'abdominal'],
  'Musculoskeletal': ['musculoskeletal', 'bone', 'joint', 'orthopedic', 'msk', 'skeletal'],
  'Breast': ['breast', 'mammography', 'mammogram', 'mammographic'],
  'Nuclear/Molecular': ['nuclear', 'pet', 'molecular', 'spect', 'radioisotope'],
  'General/Other': [] // Catch-all category
};

// Define major clinical radiology journals
const CLINICAL_RADIOLOGY_JOURNALS = [
  'Radiology',
  'European Radiology',
  'American Journal of Roentgenology',
  'European Journal of Radiology',
  'Academic Radiology',
  'Journal of Digital Imaging',
  'Clinical Radiology',
  'British Journal of Radiology',
  'Radiographics',
  'Journal of the American College of Radiology',
  'Investigative Radiology',
  'Abdominal Radiology',
  'Neuroradiology',
  'Pediatric Radiology',
  'CardioVascular and Interventional Radiology',
  'Emergency Radiology'
];

// Add this with the other helper functions at the top
const getDateOfWeek = (week, year) => {
  const date = new Date(year, 0, 1 + (week - 1) * 7);
  return date;
};

// Helper: Format a Date as "YYYY/MM/DD"
function formatDate(date) {
  const yyyy = date.getFullYear();
  const mm = (date.getMonth() + 1).toString().padStart(2, '0');
  const dd = date.getDate().toString().padStart(2, '0');
  return `${yyyy}/${mm}/${dd}`;
}

// Categorize article by subdomain based on title and abstract
function categorizeArticle(article) {
  const text = (article.title + ' ' + article.abstract).toLowerCase();
  
  for (const [subdomain, keywords] of Object.entries(radiologySubdomains)) {
    if (keywords.some(keyword => text.includes(keyword))) {
      return subdomain;
    }
  }
  return 'General/Other';
}

// Add this helper function for week-based date handling
const getWeekDates = (date = new Date()) => {
  const curr = new Date(date);
  const first = curr.getDate() - curr.getDay();
  const firstDay = new Date(curr.setDate(first));
  const lastDay = new Date(curr.setDate(first + 6));
  return { firstDay, lastDay };
};

// Add this helper function at the top with other helpers
const getWeekNumber = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 4 - (d.getDay() || 7));
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const weekNumber = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getFullYear()}-W${weekNumber.toString().padStart(2, '0')}`;
};

// Update the NavigationBar component
const NavigationBar = ({ onSectionClick, activeSection }) => (
  <nav className="nav-bar" role="navigation" aria-label="Main navigation">
    <div className="nav-container">
      <a href="/" className="nav-logo" aria-label="Home">
        Radiology AI Dashboard
      </a>
      <div className="nav-links">
        <a
          href="#overview"
          className={`nav-link ${activeSection === 'overview' ? 'active' : ''}`}
          onClick={() => onSectionClick('overview')}
        >
          Overview
        </a>
        <a
          href="#statistics"
          className={`nav-link ${activeSection === 'statistics' ? 'active' : ''}`}
          onClick={() => onSectionClick('statistics')}
        >
          Statistics
        </a>
        <a
          href="#publications"
          className={`nav-link ${activeSection === 'publications' ? 'active' : ''}`}
          onClick={() => onSectionClick('publications')}
        >
          Publications
        </a>
        <a
          href="#help"
          className={`nav-link ${activeSection === 'help' ? 'active' : ''}`}
          onClick={() => onSectionClick('help')}
        >
          Help
        </a>
      </div>
    </div>
  </nav>
);

// Update Google Scholar configuration
const GOOGLE_SCHOLAR_CONFIG = {
  baseUrl: 'https://corsproxy.io/?',
  searchQuery: 'artificial intelligence radiology clinical',
  yearRange: 1
};

function App() {
  // State declarations first
  const [articles, setArticles] = useState([]);
  const [subdomainStats, setSubdomainStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const articlesPerPage = 10;
  const [selectedSubdomain, setSelectedSubdomain] = useState(null);
  const [showFAQ, setShowFAQ] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(localStorage.getItem('lastRefresh') || null);
  const [dateRange, setDateRange] = useState([null, null]);
  const [startDate, endDate] = dateRange;
  const [activeSection, setActiveSection] = useState('overview');

  // Add these at the top level of your App component
  const CACHE_KEY = 'radiology_ai_articles';
  const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

  // Add this function to handle caching
  const getCachedArticles = () => {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const { timestamp, data } = JSON.parse(cached);
      if (Date.now() - timestamp < CACHE_DURATION) {
        return data;
      }
    }
    return null;
  };

  // Move searchTerms inside App
  const searchTerms = useMemo(() => [
    `("Artificial Intelligence"[Mesh] OR "Deep Learning"[Mesh] OR "Machine Learning"[Mesh]) AND (${
      CLINICAL_RADIOLOGY_JOURNALS.map(journal => `"${journal}"[Journal]`).join(' OR ')
    })`,
    `("Artificial Intelligence" OR "Deep Learning" OR "Machine Learning") AND (${
      CLINICAL_RADIOLOGY_JOURNALS.map(journal => `"${journal}"[Journal]`).join(' OR ')
    }) AND ("Clinical Trial"[Publication Type] OR "Validation Studies"[Publication Type])`,
    `(artificial intelligence[Title/Abstract] OR machine learning[Title/Abstract]) AND (${
      CLINICAL_RADIOLOGY_JOURNALS.map(journal => `"${journal}"[Journal]`).join(' OR ')
    })`
  ], []);

  // Add updateStats function
  const updateStats = useCallback((articles) => {
    const stats = {};
    articles.forEach(article => {
      const subdomain = categorizeArticle(article);
      stats[subdomain] = (stats[subdomain] || 0) + 1;
    });
    setSubdomainStats(stats);
  }, []);

  // Add isClinicalPaper function
  const isClinicalPaper = useCallback((article) => {
    if (!CLINICAL_RADIOLOGY_JOURNALS.some(journal => 
      article.journal.toLowerCase().includes(journal.toLowerCase())
    )) {
      return false;
    }

    const text = (
      article.title + ' ' + 
      article.abstract
    ).toLowerCase();

    const hasAI = text.includes('artificial intelligence') || 
                  text.includes('machine learning') || 
                  text.includes('deep learning') ||
                  text.includes('neural network');

    const hasImaging = text.includes('imaging') ||
                      text.includes('radiology') ||
                      text.includes('radiological') ||
                      text.includes('radiographic');

    const nonClinicalIndicators = [
      'letter to editor',
      'editorial',
      'erratum',
      'retraction'
    ];
    const isNonClinical = nonClinicalIndicators.some(term => text.includes(term));

    return hasAI && hasImaging && !isNonClinical;
  }, []);

  // Add processArticle function
  const processArticle = useCallback((item, now) => {
    const pubDateStr = item.pubdate || item.sortpubdate;
    let pubDate;
    try {
      pubDate = pubDateStr ? new Date(pubDateStr) : now;
    } catch (e) {
      pubDate = now;
    }

    const metadata = {
      title: item.title || "No Title",
      abstract: item.abstract || "",
      authors: item.authors?.map(a => a.name) || [],
      journal: item.fulljournalname || "",
      publicationDate: pubDate.toISOString(),
      year: pubDate.getFullYear(),
      link: `https://pubmed.ncbi.nlm.nih.gov/${item.uid}`,
      meshTerms: item.mesh || [],
      publicationType: item.pubtype || [],
      chemicals: item.chemicals || [],
      keywords: item.keywords || [],
      dateIndexed: new Date().toISOString()
    };

    return isClinicalPaper(metadata) ? metadata : null;
  }, [isClinicalPaper]);

  // Move fetchGoogleScholar inside App
  const fetchGoogleScholar = useCallback(async () => {
    console.log('Fetching from Google Scholar...');
    
    try {
      const searchUrl = `${GOOGLE_SCHOLAR_CONFIG.baseUrl}${encodeURIComponent(
        `https://scholar.google.com/scholar?q=${
          encodeURIComponent(GOOGLE_SCHOLAR_CONFIG.searchQuery)
        }&as_ylo=${new Date().getFullYear() - GOOGLE_SCHOLAR_CONFIG.yearRange}`
      )}`;

      const response = await axios.get(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      const $ = cheerio.load(response.data);
      const articles = [];

      $('.gs_r').each((i, element) => {
        const $element = $(element);
        
        const article = {
          title: $element.find('.gs_rt').text().trim(),
          authors: $element.find('.gs_a').text().trim(),
          abstract: $element.find('.gs_rs').text().trim(),
          link: $element.find('.gs_rt a').attr('href'),
          citations: parseInt($element.find('.gs_fl a:contains("Cited by")').text().match(/\d+/) || '0'),
          publicationDate: new Date().toISOString(), // Approximate date
          source: 'Google Scholar'
        };

        // Only include if it matches our clinical criteria
        if (isClinicalPaper(article)) {
          articles.push(article);
        }
      });

      return articles;
    } catch (error) {
      console.error('Error fetching from Google Scholar:', error);
      return [];
    }
  }, [isClinicalPaper]);

  // Move fetchPubMedArticles inside App
  const fetchPubMedArticles = useCallback(async () => {
    const baseUrl = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
    
    try {
      // Get current date and 30 days ago
      const now = new Date();
      const thirtyDaysAgo = new Date(now.setDate(now.getDate() - 30));
      
      const searchParams = {
        db: 'pubmed',
        retmax: 100,
        retmode: 'json',
        sort: 'date',
        // Remove API key requirement
        tool: 'radiology-ai-dashboard',
        email: 'user@example.com', // Required by PubMed for tracking
        mindate: thirtyDaysAgo.toISOString().split('T')[0],
        maxdate: new Date().toISOString().split('T')[0]
      };

      const articles = [];
      
      // Use a public CORS proxy
      const corsProxy = 'https://corsproxy.io/?';
      
      // Fetch articles for each search term with proper rate limiting
      for (const term of searchTerms) {
        const searchUrl = `${corsProxy}${encodeURIComponent(
          `${baseUrl}/esearch.fcgi?${new URLSearchParams({
            ...searchParams,
            term: term
          })}`
        )}`;

        const searchResponse = await fetchWithRetry(searchUrl);
        const ids = searchResponse.data.esearchresult.idlist;

        if (ids.length > 0) {
          // Fetch details in batches of 5 (reduced from 10 to avoid rate limits)
          for (let i = 0; i < ids.length; i += 5) {
            const batchIds = ids.slice(i, i + 5);
            const summaryUrl = `${corsProxy}${encodeURIComponent(
              `${baseUrl}/esummary.fcgi?${new URLSearchParams({
                db: 'pubmed',
                id: batchIds.join(','),
                retmode: 'json',
                tool: 'radiology-ai-dashboard',
                email: 'user@example.com'
              })}`
            )}`;

            // Add longer delay between requests
            await delay(1000);
            
            const detailsResponse = await fetchWithRetry(summaryUrl);
            
            Object.values(detailsResponse.data.result)
              .filter(item => item?.uid)
              .forEach(item => {
                const processedArticle = processArticle(item, new Date());
                if (processedArticle) {
                  articles.push(processedArticle);
                }
              });
          }
        }
      }

      return articles;
    } catch (error) {
      console.error('Error fetching from PubMed:', error);
      return [];
    }
  }, [searchTerms, processArticle]);

  // Update fetchArticles dependencies
  const fetchArticles = useCallback(async () => {
    setLoading(true);
    console.log('Fetching articles from multiple sources...');
    
    try {
      // Fetch from both sources in parallel
      const [pubmedArticles, scholarArticles] = await Promise.all([
        fetchPubMedArticles(),
        fetchGoogleScholar()
      ]);

      // Combine and deduplicate articles
      const combined = [...pubmedArticles];
      
      scholarArticles.forEach(scholarArticle => {
        // Check if article already exists (by title similarity)
        const isDuplicate = combined.some(article => 
          stringSimilarity.compareTwoStrings(
            article.title.toLowerCase(),
            scholarArticle.title.toLowerCase()
          ) > 0.8
        );

        if (!isDuplicate) {
          combined.push(scholarArticle);
        }
      });

      // Sort by date (newest first)
      combined.sort((a, b) => new Date(b.publicationDate) - new Date(a.publicationDate));

      setArticles(combined);
      updateStats(combined);
    } catch (error) {
      console.error('Error fetching articles:', error);
      setError("Failed to fetch articles. Please try again later.");
    } finally {
      setLoading(false);
    }
  }, [fetchPubMedArticles, fetchGoogleScholar]);

  // Enhanced data refresh logic
  const checkAndRefresh = useCallback(() => {
    const now = new Date();
    const lastRefreshDate = lastRefresh ? new Date(lastRefresh) : null;
    
    // Check if it's a new day
    const isNewDay = !lastRefreshDate || 
      lastRefreshDate.getDate() !== now.getDate() ||
      lastRefreshDate.getMonth() !== now.getMonth() ||
      lastRefreshDate.getFullYear() !== now.getFullYear();
    
    if (isNewDay) {
      fetchArticles();
      setLastRefresh(now.toISOString());
      localStorage.setItem('lastRefresh', now.toISOString());
    }
  }, [lastRefresh, fetchArticles]);

  // Update useEffect to check more frequently
  useEffect(() => {
    // Initial fetch
    if (!lastRefresh) {
      fetchArticles();
    }
    
    // Check for refresh every 30 minutes
    const interval = setInterval(checkAndRefresh, 30 * 60 * 1000);
    
    // Also check when the window regains focus
    const handleFocus = () => checkAndRefresh();
    window.addEventListener('focus', handleFocus);
    
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
    };
  }, [fetchArticles, checkAndRefresh, lastRefresh]);

  // Update the useEffect hook
  useEffect(() => {
    const initializeArticles = async () => {
      setLoading(true);
      try {
        // Try to get cached articles first
        const cached = getCachedArticles();
        if (cached) {
          setArticles(cached);
          updateStats(cached);
          return;
        }

        // If no cache, fetch new articles
        const articles = await fetchArticles();
        
        // Cache the results
        localStorage.setItem(CACHE_KEY, JSON.stringify({
          timestamp: Date.now(),
          data: articles
        }));
        
      } catch (error) {
        console.error('Error initializing articles:', error);
        setError('Failed to load articles. Please try again later.');
      } finally {
        setLoading(false);
      }
    };

    initializeArticles();
  }, [fetchArticles]);

  // Add this FAQ data
  const faqData = [
    {
      question: "How often is the data updated?",
      answer: "The dashboard fetches new articles from PubMed at the start of each session and can be manually refreshed. Articles are from the current month, using official MeSH terms for AI in Radiology."
    },
    {
      question: "How are articles categorized?",
      answer: "Articles are automatically categorized into radiology subdomains based on their titles, abstracts, and MeSH terms. Each article can appear in multiple categories if relevant."
    },
    {
      question: "What is the search strategy?",
      answer: "We use PubMed's official MeSH terms combining Artificial Intelligence, Deep Learning, and Machine Learning with Radiology and Diagnostic Imaging terms. This ensures high-quality, relevant results."
    },
    {
      question: "How many articles are displayed?",
      answer: "The dashboard shows 10 articles per page, with the ability to navigate through all results. Articles are sorted by publication date (newest first)."
    }
  ];

  // Add date range filtering
  const getFilteredArticles = useCallback(() => {
    if (!startDate && !endDate) return articles;

    return articles.filter(article => {
      const pubDate = new Date(article.publicationDate);
      if (startDate && endDate) {
        return pubDate >= startDate && pubDate <= endDate;
      }
      if (startDate) {
        return pubDate >= startDate;
      }
      if (endDate) {
        return pubDate <= endDate;
      }
      return true;
    });
  }, [articles, startDate, endDate]);

  // Update the filtering logic to include subdomain filtering
  const filteredArticles = getFilteredArticles().filter(article => {
    const matchesSearch = article.title.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesSubdomain = !selectedSubdomain || article.subdomain === selectedSubdomain;
    return matchesSearch && matchesSubdomain;
  });

  const pageCount = Math.ceil(filteredArticles.length / articlesPerPage);
  const currentArticles = filteredArticles.slice(
    (currentPage - 1) * articlesPerPage,
    currentPage * articlesPerPage
  );

  // Prepare data for the Pie Chart (subdomain distribution)
  const chartData = {
    labels: Object.keys(subdomainStats),
    datasets: [{
      data: Object.values(subdomainStats),
      backgroundColor: [
        '#3b82f6',  // Blue
        '#6366f1',  // Indigo
        '#8b5cf6',  // Purple
        '#ec4899',  // Pink
        '#f43f5e',  // Rose
        '#f97316',  // Orange
        '#eab308'   // Yellow
      ]
    }]
  };

  // Update Pie chart options
  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'right',
        labels: {
          color: '#ffffff',
          font: {
            size: 14,
            family: "'Open Sans', sans-serif"
          },
          padding: 20
        }
      }
    }
  };

  // Update WeeklyStats component
  const WeeklyStats = ({ articles }) => {
    const formatWeekLabel = useCallback((weekKey) => {
      const [year, week] = weekKey.split('-W');
      const date = getDateOfWeek(parseInt(week), parseInt(year));
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }, []);

    const weeklyData = useMemo(() => {
      const weeks = {};
      articles.forEach(article => {
        const date = new Date(article.publicationDate);
        const weekKey = getWeekNumber(date);
        weeks[weekKey] = (weeks[weekKey] || 0) + 1;
      });

      return Object.entries(weeks)
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-12)
        .map(([week, count]) => ({
          week: formatWeekLabel(week),
          count
        }));
    }, [articles, formatWeekLabel]);

    // Update Line chart options
    const lineChartOptions = {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          grid: { color: 'rgba(255, 255, 255, 0.1)' },
          ticks: { color: '#ffffff' }
        },
        y: {
          grid: { color: 'rgba(255, 255, 255, 0.1)' },
          ticks: { color: '#ffffff' }
        }
      },
      plugins: {
        legend: {
          display: false
        }
      }
    };

    return (
      <div className="charts-section">
        <h2>Weekly Publication Trends</h2>
        <div className="chart-container">
          <Line
            data={{
              labels: weeklyData.map(data => data.week),
              datasets: [{
                label: 'Articles per Week',
                data: weeklyData.map(data => data.count),
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                tension: 0.4
              }]
            }}
            options={lineChartOptions}
          />
        </div>
      </div>
    );
  };

  // Update the article rendering section
  const ArticleCard = ({ article }) => (
    <article 
      className="article-card" 
      tabIndex="0"
      onClick={() => window.open(article.link, '_blank', 'noopener,noreferrer')}
    >
      <span className="article-category" role="tag">
        {article.subdomain || 'General'}
      </span>
      <h3 className="article-title">
        {article.title}
      </h3>
      <div className="article-meta">
        <span className="article-journal">
          {article.journal || article.source}
          {article.citations > 0 && ` • ${article.citations} citations`}
        </span>
        <time dateTime={article.publicationDate}>
          {new Date(article.publicationDate).toLocaleDateString()}
        </time>
      </div>
    </article>
  );

  const HeroSection = ({ stats }) => (
    <section className="hero-section">
      <h1 className="hero-title">Radiology AI Research Dashboard</h1>
      <p className="hero-subtitle">
        Track and analyze the latest developments in AI-powered radiology research
      </p>
      <div className="quick-stats">
        <div className="quick-stat">
          <div className="quick-stat-value">{stats.totalArticles}</div>
          <div className="quick-stat-label">Publications</div>
        </div>
        <div className="quick-stat">
          <div className="quick-stat-value">{stats.topSubdomain}</div>
          <div className="quick-stat-label">Top Specialty</div>
        </div>
        <div className="quick-stat">
          <div className="quick-stat-value">{stats.avgAuthors}</div>
          <div className="quick-stat-label">Avg. Authors</div>
        </div>
      </div>
    </section>
  );

  return (
    <>
      <NavigationBar 
        onSectionClick={setActiveSection} 
        activeSection={activeSection} 
      />
      <div className="dashboard">
        {loading ? (
          <div className="loading-state">
            <div className="loading-spinner"></div>
            <p>Loading articles...</p>
          </div>
        ) : error ? (
          <div className="error-state">
            <p>{error}</p>
            <button onClick={() => fetchArticles()}>Retry</button>
          </div>
        ) : (
          <>
            {activeSection === 'overview' && (
              <>
                <HeroSection stats={{
                  totalArticles: articles.length,
                  topSubdomain: Object.entries(subdomainStats)
                    .reduce((max, [key, value]) => 
                      value > max.value ? {key, value} : max, 
                      {key: '', value: 0}
                    ).key.split('/')[0],
                  avgAuthors: (articles.reduce((acc, curr) => 
                    acc + (curr.authors ? curr.authors.length : 0), 0) / articles.length || 0)
                    .toFixed(1)
                }} />
              </>
            )}

            {activeSection === 'statistics' && (
              <>
                <div className="charts-section">
                  <h2>Distribution by Radiology Subdomain</h2>
                  <div className="chart-container">
                    <Pie data={chartData} options={chartOptions} />
                  </div>
                </div>
                <WeeklyStats articles={articles} />
              </>
            )}

            {activeSection === 'publications' && (
              <>
                <div className="filters-container">
                  <div className="date-range-picker">
                    <DatePicker
                      selectsRange={true}
                      startDate={startDate}
                      endDate={endDate}
                      onChange={(update) => setDateRange(update)}
                      isClearable={true}
                      placeholderText="Select date range"
                      className="date-picker"
                    />
                  </div>
                  <div className="search-container">
                    <input
                      className="search-input"
                      type="text"
                      value={searchTerm}
                      placeholder="Search articles..."
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                  </div>
                </div>

                <div className="subdomain-filters">
                  {Object.keys(radiologySubdomains).map(domain => (
                    <button
                      key={domain}
                      className={`subdomain-filter ${selectedSubdomain === domain ? 'active' : ''}`}
                      onClick={() => setSelectedSubdomain(domain)}
                    >
                      {domain}
                    </button>
                  ))}
                </div>

                <div className="articles-container">
                  {currentArticles.map(article => (
                    <ArticleCard key={article.uid} article={article} />
                  ))}
                </div>

                <div className="pagination">
                  {Array.from({ length: pageCount }, (_, i) => (
                    <button
                      key={i + 1}
                      className={`page-button ${currentPage === i + 1 ? 'active' : ''}`}
                      onClick={() => setCurrentPage(i + 1)}
                    >
                      {i + 1}
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}

export default App;