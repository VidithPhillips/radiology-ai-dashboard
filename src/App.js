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

function App() {
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

  // Update search terms to target clinical radiology journals
  const searchTerms = useMemo(() => [
    `("Artificial Intelligence"[Mesh] OR "Deep Learning"[Mesh]) AND (${
      CLINICAL_RADIOLOGY_JOURNALS.map(journal => `"${journal}"[Journal]`).join(' OR ')
    })`,
    
    `("Machine Learning"[Mesh] OR "Neural Networks, Computer"[Mesh]) AND (${
      CLINICAL_RADIOLOGY_JOURNALS.map(journal => `"${journal}"[Journal]`).join(' OR ')
    }) AND ("Clinical Trial"[Publication Type] OR "Observational Study"[Publication Type] OR "Validation Study"[Publication Type])`,
    
    // Additional search for clinical implementation papers
    `("Artificial Intelligence"[Mesh] OR "Machine Learning"[Mesh]) AND (${
      CLINICAL_RADIOLOGY_JOURNALS.map(journal => `"${journal}"[Journal]`).join(' OR ')
    }) AND ("Clinical Study"[Publication Type] OR "Evaluation Study"[Publication Type])`
  ], []);

  // Enhanced clinical relevance checking
  const isClinicalPaper = (article) => {
    // Check if journal is in our approved list
    if (!CLINICAL_RADIOLOGY_JOURNALS.some(journal => 
      article.journal.toLowerCase().includes(journal.toLowerCase())
    )) {
      return false;
    }

    const clinicalTerms = {
      required: [
        'patient', 'clinical', 'diagnostic', 'diagnosis', 'treatment',
        'hospital', 'medical', 'healthcare', 'radiologist'
      ],
      modalities: [
        'mri', 'ct', 'ultrasound', 'x-ray', 'radiograph', 'imaging',
        'pet', 'spect', 'mammogram', 'tomography'
      ],
      aiTerms: [
        'deep learning', 'machine learning', 'artificial intelligence',
        'neural network', 'cnn', 'computer-aided', 'automated'
      ],
      clinicalContext: [
        'diagnosis', 'prognosis', 'screening', 'detection', 'segmentation',
        'classification', 'prediction', 'outcome', 'survival', 'mortality',
        'assessment', 'evaluation', 'analysis', 'interpretation'
      ],
      clinicalStudyTypes: [
        'retrospective', 'prospective', 'cohort', 'clinical trial',
        'validation study', 'evaluation study', 'patient study',
        'multi-center', 'single-center'
      ]
    };

    const text = (
      article.title + ' ' + 
      article.abstract + ' ' + 
      article.meshTerms.join(' ') + ' ' +
      (article.publicationType || []).join(' ')
    ).toLowerCase();

    // Must have at least one term from each category
    const hasRequired = clinicalTerms.required.some(term => text.includes(term));
    const hasModality = clinicalTerms.modalities.some(term => text.includes(term));
    const hasAI = clinicalTerms.aiTerms.some(term => text.includes(term));
    const hasClinicalContext = clinicalTerms.clinicalContext.some(term => text.includes(term));
    const hasStudyType = clinicalTerms.clinicalStudyTypes.some(term => text.includes(term));

    // Check for explicit non-clinical indicators
    const nonClinicalIndicators = [
      'simulation', 'phantom', 'in-vitro', 'proof of concept',
      'theoretical', 'framework', 'review article', 'survey',
      'systematic review', 'meta-analysis', 'opinion', 'editorial',
      'letter to the editor', 'technical note'
    ];
    const isNonClinical = nonClinicalIndicators.some(term => text.includes(term));

    return hasRequired && hasModality && hasAI && hasClinicalContext && 
           hasStudyType && !isNonClinical;
  };

  // Enhanced article processing
  const processArticle = useCallback((item, now) => {
    const pubDateStr = item.pubdate || item.sortpubdate;
    let pubDate;
    try {
      pubDate = pubDateStr ? new Date(pubDateStr) : now;
    } catch (e) {
      pubDate = now;
    }

    // Enhanced metadata extraction
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

    // Only process if it's a clinical paper
    if (!isClinicalPaper(metadata)) {
      return null;
    }

    return metadata;
  }, []);

  // Update fetchArticles dependencies
  const fetchArticles = useCallback(async () => {
    const now = new Date();
    const { firstDay, lastDay } = getWeekDates(now);
    const prevWeek = new Date(firstDay);
    prevWeek.setDate(prevWeek.getDate() - 7);
    
    const mindate = formatDate(prevWeek);
    const maxdate = formatDate(lastDay);
    
    // Get existing articles from localStorage
    const storedArticles = JSON.parse(localStorage.getItem('articles') || '[]');
    let combined = [...storedArticles];

    try {
      for (const term of searchTerms) {
        try {
          // Update retmax to get more articles per week
          const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(term)}&retmax=200&sort=date&datetype=pdat&mindate=${mindate}&maxdate=${maxdate}&retmode=json&usehistory=y`;
          const searchProxyUrl = "https://api.allorigins.win/raw?url=" + encodeURIComponent(searchUrl);
          const searchRes = await axios.get(searchProxyUrl);
          
          if (!searchRes.data || !searchRes.data.esearchresult) {
            console.warn(`Invalid response for search term: ${term}`);
            continue;
          }

          const idList = searchRes.data.esearchresult.idlist || [];
          if (idList.length > 0) {
            const detailsUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${idList.join(",")}&retmode=json`;
            const detailsProxyUrl = "https://api.allorigins.win/raw?url=" + encodeURIComponent(detailsUrl);
            const detailsRes = await axios.get(detailsProxyUrl);

            if (!detailsRes.data || !detailsRes.data.result) {
              console.warn('Invalid details response');
              continue;
            }

            // Process and add new articles
            Object.values(detailsRes.data.result)
              .filter(item => item?.uid)
              .forEach(item => {
                const newArticle = processArticle(item, now);
                
                // Only add if not already in combined
                if (!combined.some(existing => existing.title === newArticle.title)) {
                  combined.push(newArticle);
                }
              });
          }
        } catch (termError) {
          console.warn(`Error processing term "${term}":`, termError);
          continue;
        }
      }

      // Sort by date (newest first)
      combined.sort((a, b) => new Date(b.dateIndexed) - new Date(a.dateIndexed));

      // Store in localStorage
      localStorage.setItem('articles', JSON.stringify(combined));

      if (combined.length === 0) {
        setError("No articles found for the specified criteria.");
        return;
      }

      // Update state with all articles
      setArticles(combined);

      // Update subdomain stats
      const stats = Object.keys(radiologySubdomains).reduce((acc, key) => ({ ...acc, [key]: 0 }), {});
      combined.forEach(article => {
        const subdomain = categorizeArticle(article);
        stats[subdomain] = (stats[subdomain] || 0) + 1;
        article.subdomain = subdomain;
      });

      setSubdomainStats(stats);
      setError(null);

      // Store with date information
      const articlesByWeek = {};
      combined.forEach(article => {
        const pubDate = new Date(article.publicationDate);
        const { firstDay } = getWeekDates(pubDate);
        const weekKey = firstDay.toISOString().split('T')[0];
        articlesByWeek[weekKey] = articlesByWeek[weekKey] || [];
        articlesByWeek[weekKey].push(article);
      });

      localStorage.setItem('articlesByWeek', JSON.stringify(articlesByWeek));
    } catch (e) {
      console.error("Error fetching articles:", e);
      setError("Failed to fetch articles. Please try again later.");
    } finally {
      setLoading(false);
    }
  }, [processArticle, searchTerms]);

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
        '#d946ef',  // Fuchsia
        '#ec4899',  // Pink
        '#f43f5e',  // Rose
        '#10b981'   // Emerald
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
          color: '#ffffff', // Make text white
          font: {
            size: 14,
            family: "'Open Sans', sans-serif"
          },
          padding: 20
        }
      },
      tooltip: {
        backgroundColor: 'rgba(17, 24, 39, 0.95)', // Dark background
        titleColor: '#ffffff',
        bodyColor: '#ffffff',
        bodyFont: {
          family: "'Open Sans', sans-serif"
        },
        padding: 12,
        borderColor: '#1f2937',
        borderWidth: 1
      }
    },
    scales: {
      x: {
        ticks: {
          font: {
            size: 14
          }
        },
        grid: {
          display: false
        }
      },
      y: {
        ticks: {
          font: {
            size: 14
          }
        },
        grid: {
          color: 'rgba(0, 0, 0, 0.1)'
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
      onKeyPress={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          window.open(article.link, '_blank', 'noopener,noreferrer');
        }
      }}
    >
      <span className="article-category" role="tag">
        {article.subdomain || 'General'}
      </span>
      <h3 className="article-title">
        {article.title}
      </h3>
      <div className="article-meta">
        <span className="article-journal">{article.journal}</span>
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
                  onClick={() => setSelectedSubdomain(selectedSubdomain === domain ? null : domain)}
                >
                  {domain}
                </button>
              ))}
            </div>

            <section className="articles-section">
              <div className="articles-grid">
                {currentArticles.map((article, index) => (
                  <ArticleCard key={index} article={article} />
                ))}
              </div>
              {/* Add pagination here */}
            </section>
          </>
        )}

        {activeSection === 'help' && (
          <div className="faq-section">
            <h2>Frequently Asked Questions</h2>
            {faqData.map((faq, index) => (
              <div key={index} className="faq-item">
                <div className="faq-question">{faq.question}</div>
                <div className="faq-answer">{faq.answer}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export default App;