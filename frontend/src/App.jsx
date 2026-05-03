import React, { useState, useEffect } from 'react';
import { 
  Search, 
  TrendingUp, 
  Calendar, 
  ShoppingBag, 
  IndianRupee, 
  Lightbulb,
  ArrowRight,
  Download,
  Image as ImageIcon,
  Upload
} from 'lucide-react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

const App = () => {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [trendLoading, setTrendLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [trendData, setTrendData] = useState(null);
  const [error, setError] = useState(null);
  const [selectedImage, setSelectedImage] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [sourceInfo, setSourceInfo] = useState(null);
  const reportRef = React.useRef(null);

  const suggestions = [
    "Diwali fashion trends",
    "Wedding gold jewelry trends",
    "Summer Fashion trends in India"
  ];

  const handleExportPDF = async () => {
    if (!reportRef.current) return;
    
    const btn = document.getElementById('export-btn');
    const originalText = btn.innerHTML;
    btn.innerHTML = 'Generating PDF...';

    try {
      if (!window.html2canvas || !window.jspdf) {
        throw new Error("PDF libraries not loaded yet. Please wait a moment.");
      }

      const element = reportRef.current;
      const canvas = await window.html2canvas(element, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: "#ffffff"
      });
      
      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      const { jsPDF } = window.jspdf;
      
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const imgProps = pdf.getImageProperties(imgData);
      const imgHeight = (imgProps.height * pdfWidth) / imgProps.width;
      
      pdf.addImage(imgData, 'JPEG', 0, 0, pdfWidth, imgHeight);
      
      // Manual download trigger to force filename and extension
      const blob = pdf.output('blob');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = "FashAI_Trend_Report.pdf";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

    } catch (err) {
      console.error("PDF Export Error:", err);
      alert("Failed to generate PDF: " + err.message);
    } finally {
      btn.innerHTML = originalText;
    }
  };

  const analyzeTrend = async (searchQuery) => {
    const finalQuery = searchQuery || query;
    if (!finalQuery) return;

    setLoading(true);
    setTrendLoading(true);
    setError(null);
    setResult(null);
    setTrendData(null);

    // 1. Fire both requests in parallel for maximum speed
    const aiPromise = fetch('http://localhost:8000/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: finalQuery }),
    }).then(async res => {
      if (!res.ok) throw new Error('Failed to fetch AI analysis.');
      const aiData = await res.json();
      setResult(aiData);
      setSourceInfo(aiData.source);
      if (aiData.source === "Ollama") setTimeout(() => setSourceInfo(null), 5000);
      return aiData;
    }).catch(err => setError(err.message))
    .finally(() => setLoading(false));

    const trendPromise = fetch('http://localhost:8000/trend-graph', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: finalQuery }),
    }).then(async res => {
      if (!res.ok) throw new Error('Failed to fetch real-time trends.');
      const tData = await res.json();
      setTrendData(tData);
      return tData;
    }).catch(err => console.error(err))
    .finally(() => setTrendLoading(false));

    // We don't await them sequentially anymore
    await Promise.allSettled([aiPromise, trendPromise]);
  };

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setSelectedImage(file);
    setImagePreview(URL.createObjectURL(file));

    setLoading(true);
    setError(null);
    setResult(null);
    setTrendData(null);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('query', query || 'Analyze the trend in this image');

    try {
      const response = await fetch('http://localhost:8000/analyze-image', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error('Failed to analyze image.');
      const data = await response.json();
      
      if (data.is_valid === false) {
        setError(data.error || "Incorrect image: Please upload an image related to retail fashion.");
        setResult(null);
        return;
      }

      setResult(data);
      setSourceInfo(data.source);

      if (data.source.includes("Ollama")) {
        setTimeout(() => setSourceInfo(null), 5000);
      }
      
      // Fetch Graph specifically for the image trend
      const trendQuery = (typeof data.current_trends === 'string') 
        ? data.current_trends.split(' ').slice(0,2).join(' ') 
        : 'fashion';
      
      setTrendLoading(true);
      try {
        const trendResponse = await fetch('http://localhost:8000/trend-graph', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: trendQuery }),
        });
        const tData = await trendResponse.json();
        setTrendData(tData);
      } catch (err) {
        console.error("Image Trend Graph Error:", err);
      } finally {
        setTrendLoading(false);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const chartData = {
    labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May'],
    datasets: [
      {
        label: 'Predicted Trend Index',
        data: result?.chart_data || [12, 19, 15, 25, 32],
        borderColor: '#6366f1',
        backgroundColor: 'rgba(99, 102, 241, 0.5)',
        tension: 0.4,
      },
    ],
  };

  const realTimeChartData = {
    labels: trendData?.labels || [],
    datasets: [
      {
        label: 'Real-time Interest Score',
        data: trendData?.values || [],
        borderColor: '#f43f5e',
        backgroundColor: 'rgba(244, 63, 94, 0.5)',
        tension: 0.3,
        fill: true,
      },
    ],
  };

  const chartOptions = (title) => ({
    responsive: true,
    plugins: {
      legend: { position: 'top' },
      title: { display: true, text: title },
    },
    scales: {
      x: {
        title: {
          display: true,
          text: 'Month/Year',
          color: '#64748b',
          font: { weight: 'bold' }
        }
      },
      y: { 
        beginAtZero: true, 
        max: 100,
        title: {
          display: true,
          text: 'Search Interest Score',
          color: '#64748b',
          font: { weight: 'bold' }
        }
      }
    }
  });

  return (
    <>
    <div className="app-container">
      <header>
        <h1>AI Retail Trend Analyzer</h1>
        <p className="subtitle">Real-time AI insights for the Indian Retail Market</p>
      </header>

      <div className="search-section">
        <input 
          type="text" 
          placeholder="e.g., Diwali fashion trends, Wedding jewelry..." 
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && analyzeTrend()}
        />
        <input 
          type="file" 
          id="image-upload" 
          hidden 
          accept="image/*" 
          onChange={handleImageUpload}
        />
        <label htmlFor="image-upload" className="upload-btn" title="Upload image for analysis">
          <ImageIcon size={24} />
        </label>
        <button 
          className="analyze-btn" 
          onClick={() => analyzeTrend()}
          disabled={loading || trendLoading}
        >
          {loading || trendLoading ? 'Processing...' : (
            <>
              Analyze <ArrowRight size={18} />
            </>
          )}
        </button>
      </div>

      {imagePreview && (
        <div className="image-preview-container" style={{ textAlign: 'center', marginBottom: '20px' }}>
          <div style={{ position: 'relative', display: 'inline-block' }}>
            <img src={imagePreview} alt="Preview" style={{ maxWidth: '200px', borderRadius: '10px', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }} />
            <button 
              onClick={() => { setImagePreview(null); setSelectedImage(null); }}
              style={{ position: 'absolute', top: '-10px', right: '-10px', background: '#f43f5e', color: 'white', border: 'none', borderRadius: '50%', width: '25px', height: '25px', cursor: 'pointer' }}
            >
              ×
            </button>
          </div>
          <p style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '5px' }}>Analyzing uploaded image...</p>
        </div>
      )}

      <div className="suggestions">
        {suggestions.map((s, i) => (
          <button 
            key={i} 
            className="suggestion-chip"
            onClick={() => {
              setQuery(s);
              analyzeTrend(s);
            }}
          >
            {s}
          </button>
        ))}
      </div>

      {sourceInfo === "Ollama" && (
        <div style={{ 
          backgroundColor: '#fef3c7', color: '#92400e', padding: '10px', borderRadius: '8px', 
          marginBottom: '20px', textAlign: 'center', fontSize: '0.9rem', border: '1px solid #fde68a'
        }}>
          ⚠️ Switching...
        </div>
      )}

      {sourceInfo === "Cache" && (
        <div style={{ 
          backgroundColor: '#d1fae5', color: '#065f46', padding: '10px', borderRadius: '8px', 
          marginBottom: '20px', textAlign: 'center', fontSize: '0.9rem', border: '1px solid #a7f3d0'
        }}>
          ⚡ <strong>Instant!</strong> Results loaded from cache.
        </div>
      )}

      {(loading || trendLoading) && !result && (
        <div className="loading-container">
          <div className="spinner"></div>
          <p>{loading ? "AI is analyzing trends..." : "Fetching real-time Google Trends data..."}</p>
        </div>
      )}

      {error && (
        <div className="result-card" style={{ borderLeft: '4px solid #f43f5e', color: '#f43f5e', marginBottom: '2rem' }}>
          <p><strong>Error:</strong> {error}</p>
        </div>
      )}

      {result && (
        <div className="results-wrapper">
          <div ref={reportRef} className="results-container" style={{ padding: '20px', backgroundColor: 'white', borderRadius: '15px' }}>
            <div className="results-grid">
              <div className="result-card">
                <h3><TrendingUp size={18} /> Current Trends</h3>
                <p>{result.current_trends}</p>
              </div>
              <div className="result-card">
                <h3><Calendar size={18} /> Upcoming Trends</h3>
                <p>{result.upcoming_trends}</p>
              </div>
              <div className="result-card">
                <h3><ShoppingBag size={18} /> Popular Products</h3>
                <p>{result.popular_products}</p>
              </div>
              <div className="result-card">
                <h3><IndianRupee size={18} /> Budget Suggestions</h3>
                <p>{result.budget_suggestions}</p>
              </div>
              <div className="result-card" style={{ gridColumn: '1 / -1' }}>
                <h3><Lightbulb size={18} /> Growth Driver</h3>
                <p>{result.growth_reason}</p>
              </div>
            </div>
            
            {result.real_products && result.real_products.length > 0 && (
              <div className="products-section" style={{ marginTop: '2rem', borderTop: '1px solid #f1f5f9', paddingTop: '1.5rem' }}>
                <h3 style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '10px', color: '#1e293b' }}>
                  <ShoppingBag size={20} /> Market Availability (Real-time)
                </h3>
                <div className="product-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '20px' }}>
                  {result.real_products.map((prod, idx) => (
                    <div key={idx} className="product-card" style={{ 
                      background: '#f8fafc', padding: '12px', borderRadius: '12px', 
                      display: 'flex', flexDirection: 'column', gap: '8px', border: '1px solid #e2e8f0',
                      transition: 'transform 0.2s'
                    }}>
                      <div style={{ height: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'white', borderRadius: '8px', overflow: 'hidden' }}>
                        <img src={prod.image} alt={prod.title} style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain' }} />
                      </div>
                      <p style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#1e293b', height: '2.4rem', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                        {prod.title}
                      </p>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto' }}>
                        <span style={{ color: '#10b981', fontWeight: 'bold', fontSize: '0.9rem' }}>{prod.price}</span>
                        <span style={{ fontSize: '0.7rem', color: '#64748b' }}>via {prod.source}</span>
                      </div>
                      <a 
                        href={prod.link} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        style={{ 
                          textAlign: 'center', backgroundColor: '#6366f1', color: 'white', 
                          padding: '6px', borderRadius: '6px', fontSize: '0.8rem', textDecoration: 'none',
                          marginTop: '4px'
                        }}
                      >
                        View Product
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {trendLoading ? (
              <div className="loading-container" style={{ padding: '2rem' }}>
                <div className="spinner" style={{ width: '30px', height: '30px' }}></div>
                <p>Fetching real-time 24-month trend data...</p>
              </div>
            ) : trendData && trendData.labels.length > 0 ? (
              <div className="chart-container" style={{ borderTop: '1px solid #f1f5f9', paddingTop: '1rem', marginTop: '1rem' }}>
                <Line 
                  key={`real-${JSON.stringify(trendData.values)}`}
                  data={realTimeChartData} 
                  options={chartOptions('Real Google Trends Growth (Last 2 Years)')} 
                />
              </div>
            ) : null}
          </div>

          <div className="export-section" style={{ marginTop: '2rem', textAlign: 'center', borderTop: '1px solid #e2e8f0', paddingTop: '2rem' }}>
            <h3 style={{ marginBottom: '1rem', color: '#1e293b' }}>Export Analysis Report</h3>
            <button 
              id="export-btn"
              className="analyze-btn" 
              onClick={handleExportPDF}
              style={{ backgroundColor: '#10b981', display: 'inline-flex', alignItems: 'center', gap: '10px' }}
            >
              <Download size={20} /> Download PDF Report
            </button>
          </div>
        </div>
      )}
    </div>
    
    {/* Floating Chatbot - Moved outside main container */}
    <ChatBot />
    </>
  );
};

const ChatBot = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([
    { text: "Hi! I'm your Retail Assistant. Ask me anything about fashion or shopping trends!", isBot: true }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const chatEndRef = React.useRef(null);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    if (isOpen) scrollToBottom();
  }, [messages, loading]);

  const sendMessage = async () => {
    if (!input.trim()) return;

    const userMsg = { text: input, isBot: false };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const response = await fetch('http://localhost:8000/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: input }),
      });
      const data = await response.json();
      const text = data.source === "Ollama" ? `${data.response} (via Local Ollama)` : data.response;
      setMessages(prev => [...prev, { text: text, isBot: true }]);
    } catch (err) {
      setMessages(prev => [...prev, { text: "Sorry, I'm having trouble connecting right now.", isBot: true }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="chatbot-wrapper" style={{ position: 'fixed', bottom: '30px', right: '30px', zIndex: 1000 }}>
      {!isOpen ? (
        <button 
          onClick={() => setIsOpen(true)}
          style={{ 
            width: '60px', height: '60px', borderRadius: '50%', backgroundColor: '#6366f1', 
            color: 'white', border: 'none', boxShadow: '0 10px 15px rgba(0,0,0,0.2)', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}
        >
          <TrendingUp size={28} />
        </button>
      ) : (
        <div style={{ 
          width: '320px', height: '450px', backgroundColor: 'white', borderRadius: '20px', 
          boxShadow: '0 20px 25px rgba(0,0,0,0.15)', display: 'flex', flexDirection: 'column', overflow: 'hidden',
          border: '1px solid #e2e8f0'
        }}>
          <div style={{ padding: '15px 20px', backgroundColor: '#6366f1', color: 'white', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <TrendingUp size={18} />
              <span style={{ fontWeight: 'bold' }}>FashAI Assistant</span>
            </div>
            <button onClick={() => setIsOpen(false)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: '20px' }}>×</button>
          </div>
          
          <div style={{ flex: 1, padding: '15px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {messages.map((msg, i) => (
              <div key={i} style={{ 
                alignSelf: msg.isBot ? 'flex-start' : 'flex-end',
                backgroundColor: msg.isBot ? '#f1f5f9' : '#6366f1',
                color: msg.isBot ? '#1e293b' : 'white',
                padding: '10px 15px', borderRadius: '15px', maxWidth: '80%', fontSize: '0.9rem',
                borderBottomLeftRadius: msg.isBot ? '0' : '15px',
                borderBottomRightRadius: msg.isBot ? '15px' : '0'
              }}>
                {msg.text}
              </div>
            ))}
            {loading && (
              <div style={{ alignSelf: 'flex-start', backgroundColor: '#f1f5f9', padding: '10px 15px', borderRadius: '15px', borderBottomLeftRadius: '0' }}>
                <div className="typing-dots">
                  <span></span><span></span><span></span>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          <div style={{ padding: '15px', borderTop: '1px solid #e2e8f0', display: 'flex', gap: '10px' }}>
            <input 
              type="text" 
              placeholder="Ask about trends..." 
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
              style={{ flex: 1, border: '1px solid #e2e8f0', borderRadius: '10px', padding: '8px 12px', fontSize: '0.9rem' }}
            />
            <button 
              onClick={sendMessage}
              style={{ backgroundColor: '#6366f1', color: 'white', border: 'none', borderRadius: '10px', padding: '8px 15px', cursor: 'pointer' }}
            >
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
