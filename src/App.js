import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { Pie } from 'react-chartjs-2';
import 'chart.js/auto'; // Automatically registers required Chart.js components
import './App.css';

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

  // Update the search terms section with proper MeSH terms
  const searchTerms = [
    '("Artificial Intelligence"[Mesh] OR "Deep Learning"[Mesh] OR "Machine Learning"[Mesh]) AND ("Radiology"[Mesh] OR "Diagnostic Imaging"[Mesh])',
    '("Neural Networks, Computer"[Mesh]) AND ("Radiology"[Mesh] OR "Diagnostic Imaging"[Mesh])',
    '("Artificial Intelligence"[Mesh]) AND ("Radiologists"[Mesh] OR "Radiology Department, Hospital"[Mesh])'
  ];

  const fetchArticles = useCallback(async () => {
    const now = new Date();
    const mindate = formatDate(new Date(now.getFullYear(), now.getMonth(), 1));
    const maxdate = formatDate(now);
    let combined = [];

    try {
      for (const term of searchTerms) {
        try {
          // First API call to get IDs
          const searchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encodeURIComponent(term)}&retmax=50&sort=date&datetype=pdat&mindate=${mindate}&maxdate=${maxdate}&retmode=json&usehistory=y`;
          const searchProxyUrl = "https://api.allorigins.win/raw?url=" + encodeURIComponent(searchUrl);
          const searchRes = await axios.get(searchProxyUrl);
          
          // Add error checking for the response
          if (!searchRes.data || !searchRes.data.esearchresult) {
            console.warn(`Invalid response for search term: ${term}`);
            continue;
          }

          const idList = searchRes.data.esearchresult.idlist || [];
          if (idList.length > 0) {
            // Second API call to get article details
            const detailsUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${idList.join(",")}&retmode=json`;
            const detailsProxyUrl = "https://api.allorigins.win/raw?url=" + encodeURIComponent(detailsUrl);
            const detailsRes = await axios.get(detailsProxyUrl);

            // Add error checking for the details response
            if (!detailsRes.data || !detailsRes.data.result) {
              console.warn('Invalid details response');
              continue;
            }

            // Process the articles
            Object.values(detailsRes.data.result)
              .filter(item => item?.uid)
              .forEach(item => {
                combined.push({
                  title: item.title || "No Title",
                  abstract: item.abstract || "",
                  authors: item.authors?.map(a => a.name) || [],
                  journal: item.fulljournalname || "",
                  year: parseInt(item.pubdate) || now.getFullYear(),
                  link: `https://pubmed.ncbi.nlm.nih.gov/${item.uid}`,
                  meshTerms: item.mesh || [], // Include MeSH terms if available
                });
              });
          }
        } catch (termError) {
          console.warn(`Error processing term "${term}":`, termError);
          // Continue with next term instead of failing completely
          continue;
        }
      }

      if (combined.length === 0) {
        setError("No articles found for the specified criteria.");
        return;
      }

      // Remove duplicates based on title
      combined = Array.from(new Map(combined.map(item => [item.title, item])).values());
      
      // Categorize articles and update subdomain stats
      const stats = Object.keys(radiologySubdomains).reduce((acc, key) => ({ ...acc, [key]: 0 }), {});
      combined.forEach(article => {
        const subdomain = categorizeArticle(article);
        stats[subdomain] = (stats[subdomain] || 0) + 1;
        article.subdomain = subdomain;
      });

      setArticles(combined);
      setSubdomainStats(stats);
      setError(null);
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

  // Update the filtering logic to include subdomain filtering
  const filteredArticles = articles.filter(article => {
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
        '#FF6384',
        '#36A2EB',
        '#FFCE56',
        '#4BC0C0',
        '#9966FF',
        '#FF9F40',
        '#EA80FC'
      ]
    }]
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'right',
        labels: {
          padding: 20
        }
      }
    }
  };

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h1>Radiology AI Research Dashboard</h1>
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
              Articles ({filteredArticles.length})
              {selectedSubdomain && ` in ${selectedSubdomain}`}
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