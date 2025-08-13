let problemTitle = "";
let lastGeneratedCode = "";
let lastUsedLanguage = "";
const outputText = document.getElementById("output-text");
const spinner = document.getElementById("spinner");
const titleEl = document.getElementById("problem-title");

async function detectLeetCodeLanguage() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.scripting.executeScript(
        {
          target: { tabId: tabs[0].id },
          func: () => {
            // Scan all buttons to find one matching known language names
            const languageNames = [
              "C++", "Java", "Python", "Python3", "JavaScript",
              "C", "C#", "Go", "Kotlin", "Rust", "Ruby", "Swift", "TypeScript"
            ];

            const buttons = [...document.querySelectorAll("button")];
            for (const btn of buttons) {
              const text = btn.innerText.trim();
              if (languageNames.includes(text)) {
                return text;
              }
            }
            return null;
          },
        },
        (results) => {
          const lang = results?.[0]?.result;
          if (!lang) {
            resolve(null);
            return;
          }

          // Normalize to Gemini-friendly language names
          const langMap = {
            "C++": "C++",
            "Java": "Java",
            "Python3": "Python",
            "Python": "Python",
            "JavaScript": "JavaScript",
            "C": "C",
            "C#": "C#",
            "Go": "Go",
            "Kotlin": "Kotlin",
            "Rust": "Rust",
            "Ruby": "Ruby",
            "Swift": "Swift",
            "TypeScript": "TypeScript"
          };

          const detected = langMap[lang] || lang;
          resolve(detected);
        }
      );
    });
  });
}

// 1. Get LeetCode problem title using GraphQL
chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
  const tab = tabs[0];
  chrome.scripting.executeScript(
    {
      target: { tabId: tab.id },
      func: () => {
        const slug = window.location.pathname.split("/problems/")[1]?.replace(/\/$/, "");
        return slug || null;
      },
    },
    async (results) => {
      const slug = results[0].result;

      if (!slug) {
        titleEl.innerText = "Not on a LeetCode problem page.";
        return;
      }

      const query = {
        query: `
          query getQuestionTitle($titleSlug: String!) {
            question(titleSlug: $titleSlug) {
              questionFrontendId
              title
            }
          }
        `,
        variables: { titleSlug: slug },
      };

      const response = await fetch("https://leetcode.com/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(query),
      });

        let data;
        try {
        data = await response.json();
        } catch (err) {
        titleEl.innerText = "Failed to parse LeetCode response.";
        console.error("JSON parse error:", err);
        return;
        }

        // Safely check structure
        if (data && data.data && data.data.question) {
        const q = data.data.question;
        problemTitle = `${q.questionFrontendId}. ${q.title}`;
        } else {
        titleEl.innerText = "Failed to retrieve problem title.";
        console.error("Invalid GraphQL response structure:", data);
        }
      titleEl.innerText = problemTitle;
    }
  );
});

// 2. Show/Hide Spinner
function showSpinner() {
  spinner.style.display = "block";
  outputText.innerHTML = "";
}
function hideSpinner() {
  spinner.style.display = "none";
}

// 3. Ask Gemini with prompt
async function fetchAIResponse(task, language = "Python") {
  if (!problemTitle) return "Problem title not found.";

  let prompt = "";
  if (task === "explain") {
    prompt = `Explain the high-level approach to solving the LeetCode problem: "${problemTitle}" without using any code.`;
  } else if (task === "steps") {
    prompt = `Give a detailed step-by-step explanation for solving the LeetCode problem titled "${problemTitle}", without including any code.`;
  } else if (task === "code") {
    prompt = `You are an expert competitive programmer. Write a clean, correct and most optimal solution for the LeetCode problem titled "${problemTitle}". Strictly use the ${language} programming language only. Do not output any code in other languages. Avoid explanations unless they are in comments.`.trim();
  }

  const body = {
    contents: [
      {
        parts: [{ text: prompt }],
      },
    ],
  };

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );

    const data = await response.json();
    const result = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    return result || "No response from Gemini.";
  } catch (err) {
    return "Error connecting to Gemini API.";
  }
}

function formatResponse(text) {
  if (!text) return "No content";

  text = text.trim().replace(/^\s*[\r\n]/gm, '');

  // Handle triple backtick code blocks ```language\ncode\n```
  text = text.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
    const safeCode = code
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    return `
    <div class="code-block" style="margin-bottom: 12px;">
      <pre><code class="language-${lang || "plaintext"}">${safeCode}</code></pre>
      <div class="code-actions">
        <button class="analyze-btn" data-action="analyze">Analyze Complexity</button>
        <button class="copy-btn" data-action="copy">Copy</button>
      </div>
      <div class="code-analysis-result"></div>
    </div>
  `;
});

  // Bold text: **bold**
  text = text.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");

  // Inline code: `code`
  text = text.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Bullet points and numbered lists
  const lines = text.split("\n");
  let formatted = "";
  let inList = false;

  for (let line of lines) {
    line = line.trim();

    if (line.startsWith("* ")) {
      if (!inList) {
        formatted += "<ul>";
        inList = true;
      }
      const item = line.replace(/^\* /, "");
      formatted += `<li>${item}</li>`;
    } else {
      if (inList) {
        formatted += "</ul>";
        inList = false;
      }

      if (!line) continue; 

      if (/^\d+\./.test(line)) {
        formatted += `<p><strong>${line}</strong></p>`;
      } else {
        formatted += `<p>${line}</p>`;
      }

    }
  }

  if (inList) formatted += "</ul>";

  return `<div class="rich-answer">${formatted}</div>`;
}

function hideLanguageSelector() {
  document.getElementById("language-container").style.display = "none";
}

// 5. Button handlers
// Explain Button
document.getElementById("explain-btn").addEventListener("click", async () => {
  hideLanguageSelector(); // hide language dropdown
  showSpinner();
  const result = await fetchAIResponse("explain");
  hideSpinner();
  outputText.innerHTML = formatResponse(result);
});

// Steps Button
document.getElementById("steps-btn").addEventListener("click", async () => {
  hideLanguageSelector(); // hide language dropdown
  showSpinner();
  const result = await fetchAIResponse("steps");
  hideSpinner();
  outputText.innerHTML = formatResponse(result);
});

// Code Button
document.getElementById("code-btn").addEventListener("click", async () => {
  const dropdown = document.getElementById("language");
  document.getElementById("language-container").style.display = "block"; // Show dropdown

  // Detect language when dropdown is shown
  const detectedLang = await detectLeetCodeLanguage();

  if (detectedLang) {
    const match = [...dropdown.options].find(opt => opt.value === detectedLang);
    if (match) {
      dropdown.value = detectedLang;
    }
  }

  outputText.innerText = "Select a language to generate code.";
});

// Generate Code Button
document.getElementById("generate-code-btn").addEventListener("click", async () => {
  const language = await detectLeetCodeLanguage() || document.getElementById("language").value;
  lastUsedLanguage = language;
  outputText.innerText = `Generating ${language} solution...`;
  showSpinner();
  const result = await fetchAIResponse("code", language);
  hideSpinner();
  lastGeneratedCode = result;
  outputText.innerHTML = formatResponse(result);
  hljs.highlightAll();
});

// Use event delegation so it works even for dynamically inserted buttons
  outputText.addEventListener("click", (e) => {
  const button = e.target;
  if (!button.matches(".copy-btn, .analyze-btn")) return;

  const codeElement = button.closest(".code-block")?.querySelector("code");
  const code = codeElement?.innerText || "";

  if (button.dataset.action === "copy") {
  navigator.clipboard.writeText(code).then(() => {
    // Check and remove any existing message
    const existing = button.closest(".code-block").querySelector(".copy-msg");
    if (existing) existing.remove();

    // Create message element
    const msg = document.createElement("div");
    msg.className = "copy-msg";
    msg.textContent = "Copied!";
    msg.style.color = "white";
    msg.style.fontSize = "12px";
    msg.style.textAlign = "center";
    msg.style.marginTop = "6px";

    // Append below the button group
    button.closest(".code-actions").after(msg);

    // Remove after 1.5 seconds
    setTimeout(() => msg.remove(), 1500);
  });
}

  if (button.dataset.action === "analyze") {
  
  const prompt = `You are a competitive programming assistant. Analyze the following ${lastUsedLanguage} code and provide its **time and space complexities** in Big-O notation.
  Code: ${lastGeneratedCode}`;

  const box = button.closest(".code-block").querySelector(".code-analysis-result");

  if (box.dataset.generated === "true") return;

  box.innerHTML = `
  <div style="display: flex; align-items: center; gap: 8px; color: #999; font-style: italic;">
    <svg width="16" height="16" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" stroke="#e8961c">
      <g fill="none" fill-rule="evenodd">
        <g transform="translate(2 2)" stroke-width="3">
          <circle stroke-opacity=".2" cx="18" cy="18" r="18"/>
          <path d="M36 18c0-9.94-8.06-18-18-18">
            <animateTransform
              attributeName="transform"
              type="rotate"
              from="0 18 18"
              to="360 18 18"
              dur="1s"
              repeatCount="indefinite"/>
          </path>
        </g>
      </g>
    </svg>
    Analyzing complexity...
  </div>
`;

  box.dataset.generated = "true";

  if (!lastGeneratedCode.trim()) {
    box.innerHTML = "<p>No code available to analyze.</p>";
    return;
  }

  fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
  })
    .then((res) => res.json())
    .then((data) => {
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "No response.";
      box.innerHTML = formatResponse(text);
    })
    .catch(() => {
      box.innerHTML = "<p>Failed to analyze complexity.</p>";
    });
}

});