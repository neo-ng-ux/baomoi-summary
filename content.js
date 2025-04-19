// Import cấu hình từ config.js
const { MAX_SUMMARY_LENGTH, MIN_SUMMARY_LENGTH, MAX_INPUT_LENGTH, CACHE_CLEAR_INTERVAL } = CONFIG;

// Tạo và thiết lập phần tử tooltip
const tooltip = document.createElement('div');
tooltip.className = 'article-tooltip';
document.body.appendChild(tooltip);

// Biến theo dõi trạng thái
let currentFetchController = null;
let activeLink = null;
let mouseX = 0, mouseY = 0;
let tooltipDisplayTimeout = null;

// Cache lưu tóm tắt bài viết - tự động xóa sau một khoảng thời gian
const summaryCache = new Map();
setInterval(() => summaryCache.clear(), CACHE_CLEAR_INTERVAL);

// Theo dõi vị trí chuột
document.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
});

// Hàm debounce để tránh gọi quá nhiều lần
function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
    };
}

// Hàm lên lịch hiển thị tooltip sau 0.5 giây
function scheduleTooltipDisplay(displayFunction) {
    // Xóa timeout cũ nếu có
    if (tooltipDisplayTimeout) {
        clearTimeout(tooltipDisplayTimeout);
    }
    
    // Đặt timeout mới
    tooltipDisplayTimeout = setTimeout(() => {
        // Kiểm tra xem người dùng có còn hover trên link không
        if (activeLink) {
            tooltip.classList.add('visible');
            displayFunction();
        }
    }, 300);
}

// Hàm hiển thị trạng thái đang tải
function showLoading() {
    tooltip.innerHTML = `
    <div class="loading-text">
      <div class="loading-spinner"></div>
      <span>Đang tải nội dung...</span>
    </div>
  `;
    // Không thêm class visible ở đây nữa
}

// Hàm ẩn tooltip
function hideTooltip() {
    tooltip.classList.remove('visible');

    if (tooltipDisplayTimeout) {
        clearTimeout(tooltipDisplayTimeout);
        tooltipDisplayTimeout = null;
    }

    if (currentFetchController) {
        currentFetchController.abort();
        currentFetchController = null;
    }

    activeLink = null;
}

// Hàm tính toán vị trí tooltip
function calculateTooltipPosition() {
    const tooltipWidth = 400;
    const tooltipHeight = 400;
    let left = mouseX + 10;
    let top = mouseY + 10;
    let position = 'bottom';

    // Điều chỉnh vị trí để tránh vượt quá màn hình
    if (left + tooltipWidth > window.innerWidth) {
        left = mouseX - tooltipWidth - 10;
        position = 'left';
    }

    if (top + tooltipHeight > window.innerHeight) {
        top = mouseY - tooltipHeight - 10;
        position = position === 'left' ? 'left' : 'top';
    }

    if (left < 16) {
        left = 16;
        position = 'right';
    }

    if (top < 16) {
        top = 16;
    }

    return { left, top, position };
}

// Hàm tính độ tương đồng cosine giữa hai câu
function cosineSimilarity(sentenceA, sentenceB) {
    const wordsA = sentenceA.toLowerCase().split(/\s+/);
    const wordsB = sentenceB.toLowerCase().split(/\s+/);
    const wordSet = new Set([...wordsA, ...wordsB]);

    const vectorA = Array.from(wordSet).map(word => wordsA.filter(w => w === word).length);
    const vectorB = Array.from(wordSet).map(word => wordsB.filter(w => w === word).length);

    const dotProduct = vectorA.reduce((sum, val, i) => sum + val * vectorB[i], 0);
    const magnitudeA = Math.sqrt(vectorA.reduce((sum, val) => sum + val * val, 0));
    const magnitudeB = Math.sqrt(vectorB.reduce((sum, val) => sum + val * val, 0));

    return (magnitudeA === 0 || magnitudeB === 0) ? 0 : dotProduct / (magnitudeA * magnitudeB);
}

// Hàm tính IDF (Inverse Document Frequency)
function calculateIDF(sentences) {
    const wordCounts = {};
    const totalSentences = sentences.length;

    sentences.forEach(sentence => {
        const words = new Set(sentence.toLowerCase().split(/\s+/));
        words.forEach(word => {
            wordCounts[word] = (wordCounts[word] || 0) + 1;
        });
    });

    const idf = {};
    for (const word in wordCounts) {
        idf[word] = Math.log((totalSentences - wordCounts[word] + 0.5) / (wordCounts[word] + 0.5));
    }
    return idf;
}

// Hàm tính điểm BM25 cho một câu
function bm25Score(sentence, idf) {
    const words = sentence.toLowerCase().split(/\s+/);
    return words.reduce((sum, word) => sum + (idf[word] || 0), 0);
}

// Kết hợp TextRank và BM25
function combinedRank(sentences, title) {
    const textRankScores = textRank(sentences, title);
    const idf = calculateIDF(sentences);
    const bm25Scores = sentences.map(sentence => bm25Score(sentence, idf));

    return textRankScores.map((score, i) => score + bm25Scores[i]);
}

// Thuật toán TextRank tối ưu với tiêu đề bài viết
function textRank(sentences, title) {
    if (sentences.length === 0) return [];

    const allSentences = title ? [title, ...sentences] : [...sentences];
    const graph = {};
    for (let i = 0; i < allSentences.length; i++) {
        graph[i] = {};
        for (let j = 0; j < allSentences.length; j++) {
            if (i !== j) {
                graph[i][j] = cosineSimilarity(allSentences[i], allSentences[j]);
            }
        }
    }

    const scores = new Array(allSentences.length).fill(1);
    const d = 0.85;

    for (let iter = 0; iter < 30; iter++) {
        const newScores = new Array(scores.length).fill((1 - d));
        for (const node in graph) {
            const nodeIdx = parseInt(node);
            const neighbors = Object.keys(graph[node]);

            if (neighbors.length > 0) {
                let totalWeight = 0;
                for (const neighbor of neighbors) {
                    totalWeight += graph[node][neighbor];
                }

                if (totalWeight > 0) {
                    for (const neighbor of neighbors) {
                        const neighborIdx = parseInt(neighbor);
                        const similarity = graph[node][neighbor];
                        newScores[neighborIdx] += d * (scores[nodeIdx] * similarity / totalWeight);
                    }
                }
            }
        }

        let diff = 0;
        for (let i = 0; i < scores.length; i++) {
            diff += Math.abs(newScores[i] - scores[i]);
            scores[i] = newScores[i];
        }

        if (diff < 0.0001) break;
    }

    if (title) {
        const titleIndex = 0;
        for (let i = 1; i < allSentences.length; i++) {
            const titleSimilarity = graph[titleIndex][i] || 0;
            scores[i] *= (1 + titleSimilarity * 2);
        }
        return scores.slice(1);
    }

    return scores;
}

// Hàm tạo tóm tắt từ nội dung bài viết
function generateSummary(text, title) {
    try {
        const cleanText = text
            .replace(/\n+/g, ' ')
            .replace(/\s+/g, ' ')
            .replace(/["""]/g, '"')
            .replace(/['']/g, "'")
            .trim();

        const sentences = cleanText.match(/[^.!?:]+[.!?:]+/g) || [];
        const filteredSentences = sentences.filter(s => s.trim().length > 10);
        if (filteredSentences.length < 3) {
            return "Bài viết quá ngắn để tạo tóm tắt.";
        }

        const cleanTitle = title ? title.trim() : null;
        const scores = combinedRank(filteredSentences, cleanTitle);
        const maxSentences = filteredSentences.length <= 5 ? 2 : 3;

        const topSentences = filteredSentences
            .map((sentence, index) => ({ sentence, score: scores[index], index }))
            .sort((a, b) => b.score - a.score)
            .slice(0, maxSentences)
            .sort((a, b) => a.index - b.index);

        return topSentences.map(s => s.sentence.trim()).join(' ') + '.';
    } catch (error) {
        console.error('Lỗi khi tạo tóm tắt:', error);
        return 'Không thể tạo tóm tắt cho bài viết này.';
    }
}

// Hàm lấy nội dung bài viết
async function fetchArticleContent(url, signal) {
    // Kiểm tra cache trước
    if (summaryCache.has(url)) {
        return summaryCache.get(url);
    }

    try {
        const response = await fetch(url, { signal });
        if (!response.ok) {
            throw new Error('Không thể tải nội dung');
        }

        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        const titleSelectors = [
            'meta[property="og:title"]',
            'h1.article__title',
            '.title',
            'h1',
            'h2',
        ];
        let title = '';
        for (const selector of titleSelectors) {
            const element = doc.querySelector(selector);
            if (element) {
                title = selector.includes("meta") ? element.getAttribute("content").trim() : element.textContent.trim();
                break;
            }
        }
        if (!title) {
            title = doc.querySelector('title')?.textContent?.trim() || '';
        }

        const summarySelectors = [
            'meta[name="description"]',
            'meta[property="og:description"]',
            '.sapo',
        ];
        let summary = '';
        for (const selector of summarySelectors) {
            const element = doc.querySelector(selector);
            if (element) {
                summary = selector.includes("meta") ? element.getAttribute("content").trim() : element.textContent.trim();
                break;
            }
        }

        if (!summary) {
            summary = doc.querySelector('p')?.textContent?.trim() || 'Không có sapo';
        }

        const paragraphs = Array.from(
            doc.querySelectorAll('.content-body > p:not(.media-caption)')
        )
            .map(p => p.textContent.trim())
            .filter(text => text.length > 0 && !text.includes('>>'));

        let summaryText = '';
        if (paragraphs.length > 0) {
            const fullText = paragraphs.join(' ');
            summaryText = generateSummary(fullText, title);
        }

        const content = { title, summary, summaryText };
        if (summaryText && summaryText.length >= MIN_SUMMARY_LENGTH) {
            summaryCache.set(url, content);
        }

        return content;
    } catch (error) {
        console.error("Lỗi khi fetch bài viết:", error);
        throw new Error(`Lỗi khi tải nội dung từ ${url}: ${error.message}`);
    }
}

// Xử lý khi di chuột qua liên kết
const handleHover = debounce(async (link) => {
    // Kiểm tra cache trước khi fetch
    if (summaryCache.has(link.href)) {
        const cachedData = summaryCache.get(link.href);
        scheduleTooltipDisplay(() => showTooltip(cachedData, link));
        return;
    }
    try {
        if (currentFetchController) {
            currentFetchController.abort();
        }

        currentFetchController = new AbortController();
        const signal = currentFetchController.signal;

        showLoading();
        activeLink = link;

        let timeoutId = setTimeout(() => {
            if (currentFetchController) {
                currentFetchController.abort();
                currentFetchController = null;
            }
        }, 5000);

        const content = await fetchArticleContent(link.href, signal);
        clearTimeout(timeoutId);

        if (!content.summary && !content.summaryText) {
            hideTooltip();
            return;
        }

        scheduleTooltipDisplay(() => showTooltip(content, link));
    } catch (error) {
        if (error.name !== 'AbortError') {
            console.error('Lỗi khi tải tooltip:', error);
        }
        hideTooltip();
    } finally {
        currentFetchController = null;
    }
}, 300);

// Hàm hiển thị tooltip
function showTooltip(content, link) {
    const { left, top, position } = calculateTooltipPosition();

    tooltip.className = `article-tooltip position-${position}`;
    if (tooltipDisplayTimeout) {
        tooltip.classList.add('visible');
    }
    tooltip.style.top = `${top}px`;
    tooltip.style.left = `${left}px`;

    tooltip.innerHTML = `
      <div class="tooltip-content">
        ${content.title ? `<h3>${content.title}</h3>` : ''}
        ${content.summary ? `<div class="summary">${content.summary}</div>` : ''}
        ${content.summaryText && content.summaryText !== content.summary ?
            `<div class="content">${content.summaryText}</div>` : ''}
      </div>
    `;
}

// Xử lý khi di chuột ra khỏi liên kết
const handleMouseLeave = debounce((e) => {
    const relatedTarget = e.relatedTarget || e.toElement;

    if (relatedTarget && (
        relatedTarget === tooltip ||
        tooltip.contains(relatedTarget) ||
        relatedTarget.closest('a')?.href.includes('baomoi.com')
    )) {
        return;
    }

    hideTooltip();
}, 100);

// Hàm xóa title của các thẻ a có class icon-detail
function removeTitleFromIconDetailLinks() {
    const iconDetailLinks = document.querySelectorAll('a.icon-detail');
    iconDetailLinks.forEach(link => {
        link.removeAttribute('title');
    });
}

// Gắn sự kiện cho phần tử
function attachTooltipHandler(element) {
    element.addEventListener('mouseenter', function (e) {
        const link = this.closest('a');
        if (link && link.href.includes('baomoi.com')) {
            link.removeAttribute('title');
            const img = link.querySelector('img');
            if (img) {
                const title = this.getAttribute('title');
                if (title) {
                    this.setAttribute('data-title', title);
                    this.removeAttribute('title');
                }
                handleHover(link);
            }
        }
    });

    element.addEventListener('mouseleave', function (e) {
        const savedTitle = this.getAttribute('data-title');
        if (savedTitle) {
            this.setAttribute('title', savedTitle);
        }
        const link = this.closest('a');
        if (link && link.href.includes('baomoi.com')) {
            const img = link.querySelector('img');
            if (img) {
                handleMouseLeave(e);
            }
        }
    });
}

// Gắn sự kiện cho các phần tử hiện có
document.querySelectorAll('a.icon-detail').forEach(attachTooltipHandler);

// Gắn sự kiện cho các liên kết baomoi
document.addEventListener('mouseover', (e) => {
    const link = e.target.closest('a.icon-detail');
    if (link) {
        handleHover(link);
    }
});

document.addEventListener('mouseout', (e) => {
    const link = e.target.closest('a.icon-detail');
    if (link) {
        handleMouseLeave(e);
    }
});

tooltip.addEventListener('mouseout', handleMouseLeave);

// Theo dõi DOM để gắn sự kiện cho các phần tử mới
const observer = new MutationObserver(mutations => {
    mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
            if (node.nodeType === 1) {
                if (node.matches && node.matches('a.icon-detail')) {
                    attachTooltipHandler(node);
                }
                node.querySelectorAll && node.querySelectorAll('a.icon-detail').forEach(attachTooltipHandler);
            }
        });
    });
});

observer.observe(document.body, { childList: true, subtree: true });

// Khởi tạo
removeTitleFromIconDetailLinks();
