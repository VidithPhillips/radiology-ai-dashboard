import React, { useState, useEffect, useCallback } from 'react';
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

  // Update the search terms to be more reliable
  const searchTerms = [
    '("Artificial Intelligence"[Mesh] OR "Deep Learning"[Mesh]) AND "Diagnostic Imaging"[Mesh]',
    '("Machine Learning"[Mesh]) AND "Radiology"[Mesh]',
    '("Neural Networks, Computer"[Mesh]) AND "Diagnostic Imaging"[Mesh]'
  ];

  // Add clinical domain filtering
  const isClinicalPaper = (article) => {
    const clinicalTerms = [
      'clinical trial', 'patient outcome', 'diagnostic accuracy',
      'sensitivity and specificity', 'retrospective study', 'prospective study',
      'validation', 'performance evaluation', 'clinical implementation',
      'clinical workflow', 'diagnostic performance', 'clinical practice'
    ];
    
    const text = (article.title + ' ' + article.abstract + ' ' + article.meshTerms.join(' ')).toLowerCase();
    return clinicalTerms.some(term => text.includes(term));
  };

  const processArticle = (item, now) => {
    // Extract proper publication date from PubMed data
    const pubDateStr = item.pubdate || item.sortpubdate;
    let pubDate;
    try {
      // Handle different date formats from PubMed
      pubDate = pubDateStr ? new Date(pubDateStr) : now;
    } catch (e) {
      pubDate = now;
    }

    // Only process if it's a clinical paper
    if (!isClinicalPaper({title: item.title, abstract: item.abstract, meshTerms: item.mesh || []})) {
      return null;
    }

    return {
      title: item.title || "No Title",
      abstract: item.abstract || "",
      authors: item.authors?.map(a => a.name) || [],
      journal: item.fulljournalname || "",
      publicationDate: pubDate.toISOString(),
      year: pubDate.getFullYear(),
      link: `https://pubmed.ncbi.nlm.nih.gov/${item.uid}`,
      meshTerms: item.mesh || [],
      dateIndexed: new Date().toISOString()
    };
  };

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
  }, []);

  const checkAndRefresh = useCallback(() => {
    const now = new Date();
    const lastRefreshDate = lastRefresh ? new Date(lastRefresh) : null;
    
    if (!lastRefreshDate || 
        now.getTime() - lastRefreshDate.getTime() > 24 * 60 * 60 * 1000) {
      fetchArticles();
      setLastRefresh(now.toISOString());
      localStorage.setItem('lastRefresh', now.toISOString());
    }
  }, [lastRefresh, fetchArticles]);

  useEffect(() => {
    fetchArticles();
    checkAndRefresh();
    const interval = setInterval(checkAndRefresh, 60 * 60 * 1000); // Check every hour
    return () => clearInterval(interval);
  }, [fetchArticles, checkAndRefresh]);

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

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'right',
        align: 'center',
        labels: {
          padding: 20,
          color: '#0f172a',
          font: {
            size: 13,
            weight: '500',
            family: "'Plus Jakarta Sans', sans-serif"
          },
          usePointStyle: true,
          pointStyle: 'circle',
          generateLabels: (chart) => {
            const data = chart.data;
            return data.labels.map((label, i) => ({
              text: `${label} (${data.datasets[0].data[i]})`,
              fillStyle: data.datasets[0].backgroundColor[i],
              strokeStyle: data.datasets[0].backgroundColor[i],
              lineWidth: 0,
              hidden: false,
              index: i
            }));
          }
        }
      },
      tooltip: {
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        titleColor: '#0f172a',
        bodyColor: '#0f172a',
        bodyFont: {
          family: "'Plus Jakarta Sans', sans-serif"
        },
        padding: 12,
        borderColor: '#e2e8f0',
        borderWidth: 1,
        callbacks: {
          label: function(context) {
            const value = context.raw;
            const total = context.dataset.data.reduce((a, b) => a + b, 0);
            const percentage = ((value / total) * 100).toFixed(1);
            return `${context.label}: ${value} (${percentage}%)`;
          }
        }
      }
    }
  };

  // Add a weekly stats component
  const WeeklyStats = ({ articles }) => {
    const weeklyData = articles.reduce((acc, article) => {
      const pubDate = new Date(article.publicationDate);
      const { firstDay } = getWeekDates(pubDate);
      const weekKey = firstDay.toISOString().split('T')[0];
      acc[weekKey] = acc[weekKey] || {
        count: 0,
        subdomains: {},
        journals: {}
      };
      acc[weekKey].count++;
      acc[weekKey].subdomains[article.subdomain] = (acc[weekKey].subdomains[article.subdomain] || 0) + 1;
      acc[weekKey].journals[article.journal] = (acc[weekKey].journals[article.journal] || 0) + 1;
      return acc;
    }, {});

    return (
      <div className="charts-section">
        <h2>Weekly Publication Trends</h2>
        <div className="chart-container">
          <Line
            data={{
              labels: Object.keys(weeklyData).map(date => 
                new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })),
              datasets: [{
                label: 'Articles per Week',
                data: Object.values(weeklyData).map(week => week.count),
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.1)',
                fill: true,
                tension: 0.4
              }]
            }}
            options={{
              responsive: true,
              plugins: {
                legend: {
                  display: false
                },
                tooltip: {
                  callbacks: {
                    label: (context) => {
                      const weekKey = Object.keys(weeklyData)[context.dataIndex];
                      const week = weeklyData[weekKey];
                      return [
                        `Articles: ${week.count}`,
                        `Top Subdomain: ${Object.entries(week.subdomains)
                          .sort((a, b) => b[1] - a[1])[0][0]}`,
                        `Top Journal: ${Object.entries(week.journals)
                          .sort((a, b) => b[1] - a[1])[0][0]}`
                      ];
                    }
                  }
                }
              },
              scales: {
                y: {
                  beginAtZero: true,
                  ticks: {
                    stepSize: 1
                  }
                }
              }
            }}
          />
        </div>
      </div>
    );
  };

  // Update the PublicationHeatmap component
  const PublicationHeatmap = ({ articles }) => {
    const today = new Date();
    const startDate = new Date();
    startDate.setFullYear(today.getFullYear() - 1);
    
    const articlesByDate = articles.reduce((acc, article) => {
      const date = article.publicationDate.split('T')[0];
      acc[date] = (acc[date] || 0) + 1;
      return acc;
    }, {});
    
    const values = Object.entries(articlesByDate).map(([date, count]) => ({
      date,
      count
    }));

    return (
      <div className="charts-section">
        <h2>Publication Activity</h2>
        <div className="heatmap-container">
          <CalendarHeatmap
            startDate={startDate}
            endDate={today}
            values={values}
            classForValue={(value) => {
              if (!value) return 'color-empty';
              return `color-scale-${Math.min(4, value.count)}`;
            }}
            titleForValue={(value) => {
              if (!value) return 'No publications';
              return `${new Date(value.date).toLocaleDateString()}: ${value.count} articles`;
            }}
            showWeekdayLabels={true}
            monthLabels={['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']}
          />
        </div>
      </div>
    );
  };

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h1>Radiology AI Research Dashboard</h1>
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
      </div>

      {error ? (
        <div className="error-message">{error}</div>
      ) : (
        <>
          <div className="charts-section">
            <h2>Distribution by Radiology Subdomain</h2>
            <div className="chart-container">
              <Pie data={chartData} options={chartOptions} />
            </div>
          </div>

          <div className="analytics-grid">
            <div className="stat-card">
              <div className="stat-value">{articles.length}</div>
              <div className="stat-label">Total Articles</div>
              <div className="trend-indicator trend-up">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M8 4L12 8L4 8L8 4Z" fill="currentColor"/>
                </svg>
                <span>Last 7 days</span>
              </div>
            </div>
            
            <div className="stat-card">
              <div className="stat-value">
                {Object.entries(subdomainStats)
                  .reduce((max, [key, value]) => 
                    value > max.value ? {key, value} : max, 
                    {key: '', value: 0}
                  ).key.split('/')[0]}
              </div>
              <div className="stat-label">Top Subspecialty</div>
            </div>
            
            <div className="stat-card">
              <div className="stat-value">
                {(articles.reduce((acc, curr) => 
                  acc + (curr.authors ? curr.authors.length : 0), 0) / articles.length || 0)
                  .toFixed(1)}
              </div>
              <div className="stat-label">Avg. Authors</div>
            </div>
            
            <div className="stat-card">
              <div className="stat-value">
                {Object.entries(
                  articles.reduce((acc, curr) => {
                    const journal = curr.journal.split('.')[0]; // Truncate journal name
                    acc[journal] = (acc[journal] || 0) + 1;
                    return acc;
                  }, {})
                ).sort((a, b) => b[1] - a[1])[0]?.[0] || 'N/A'}
              </div>
              <div className="stat-label">Top Journal</div>
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

          <div className="articles-section">
            <h2>
              Articles ({getFilteredArticles().length})
              {selectedSubdomain && ` in ${selectedSubdomain}`}
              {(startDate || endDate) && ' for selected date range'}
            </h2>
            {loading ? (
              <div className="loading-indicator">
                <div className="loading-spinner"></div>
                <span>Loading articles...</span>
              </div>
            ) : (
              <>
                {currentArticles.map((article, idx) => (
                  <div key={idx} className="article-card">
                    <div className="article-subdomain">{article.subdomain}</div>
                    <h4>{article.title}</h4>
                    <p><strong>Authors:</strong> {article.authors.join(", ")}</p>
                    <p><strong>Journal:</strong> {article.journal} ({article.year})</p>
                    <a href={article.link} target="_blank" rel="noopener noreferrer">
                      Read Paper
                    </a>
                  </div>
                ))}
                
                <div className="pagination">
                  <button 
                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                  >
                    Previous
                  </button>
                  <span>Page {currentPage} of {pageCount}</span>
                  <button 
                    onClick={() => setCurrentPage(p => Math.min(pageCount, p + 1))}
                    disabled={currentPage === pageCount}
                  >
                    Next
                  </button>
                </div>
              </>
            )}
          </div>

          <WeeklyStats articles={articles} />

          <PublicationHeatmap articles={articles} />

          <button className="faq-toggle" onClick={() => setShowFAQ(!showFAQ)}>
            {showFAQ ? 'Hide FAQ' : 'Show FAQ'}
          </button>

          {showFAQ && (
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
        </>
      )}
    </div>
  );
}

export default App;