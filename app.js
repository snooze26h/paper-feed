(() => {
  "use strict";

  const FEED_URL = "./filtered_feed.xml";
  const PAGE_SIZE = 20;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const DC_NAMESPACE = "http://purl.org/dc/elements/1.1/";

  const state = {
    papers: [],
    query: "",
    range: "7d",
    source: "all",
    visibleCount: PAGE_SIZE,
  };

  const elements = {
    updateLabel: document.querySelector("#update-label"),
    todayCount: document.querySelector("#today-count"),
    weekCount: document.querySelector("#week-count"),
    totalCount: document.querySelector("#total-count"),
    sourceCount: document.querySelector("#source-count"),
    resultSummary: document.querySelector("#result-summary"),
    search: document.querySelector("#paper-search"),
    sourceFilter: document.querySelector("#source-filter"),
    rangeButtons: [...document.querySelectorAll("[data-range]")],
    loadState: document.querySelector("#load-state"),
    loadMessage: document.querySelector("#load-message"),
    retryButton: document.querySelector("#retry-button"),
    list: document.querySelector("#paper-list"),
    loadMore: document.querySelector("#load-more"),
    template: document.querySelector("#paper-card-template"),
  };

  const paperDateFormatter = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  const updateDateFormatter = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function daysAgo(date, now = new Date()) {
    return Math.floor((startOfDay(now) - startOfDay(date)) / DAY_MS);
  }

  function isValidDate(date) {
    return date instanceof Date && !Number.isNaN(date.getTime());
  }

  function isToday(date) {
    return isValidDate(date) && daysAgo(date) === 0;
  }

  function isWithinSevenDays(date) {
    if (!isValidDate(date)) {
      return false;
    }
    const difference = daysAgo(date);
    return difference >= 0 && difference < 7;
  }

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function htmlToText(value) {
    const documentNode = new DOMParser().parseFromString(value || "", "text/html");
    return normalizeText(documentNode.body.textContent || "");
  }

  function cleanAbstract(value) {
    return htmlToText(value).replace(/^arXiv:[\s\S]*?\bAbstract:\s*/i, "").trim();
  }

  function childText(parent, selector) {
    return normalizeText(parent.querySelector(selector)?.textContent || "");
  }

  function safeExternalUrl(value) {
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    } catch {
      return "";
    }
  }

  function getSource(item) {
    const namespacedSource = item.getElementsByTagNameNS(DC_NAMESPACE, "source")[0];
    return normalizeText(namespacedSource?.textContent || "Unknown source");
  }

  function sourceLabel(source) {
    return source.replace(/\s+updates on arXiv\.org$/i, "").trim();
  }

  function deduplicatePapers(papers) {
    const unique = new Map();

    for (const paper of papers) {
      const key = paper.link || paper.id;
      const existing = unique.get(key);
      if (!existing || paper.date > existing.date) {
        unique.set(key, paper);
      }
    }

    return [...unique.values()].sort((left, right) => right.date - left.date);
  }

  function parseFeed(xmlText) {
    const xml = new DOMParser().parseFromString(xmlText, "application/xml");
    if (xml.querySelector("parsererror")) {
      throw new Error("RSS XML 无法解析");
    }

    const channel = xml.querySelector("channel");
    if (!channel) {
      throw new Error("RSS 中没有找到 channel");
    }

    const papers = [...channel.querySelectorAll("item")].map((item) => {
      const date = new Date(childText(item, "pubDate"));
      const link = safeExternalUrl(childText(item, "link"));
      return {
        id: childText(item, "guid") || link,
        title: childText(item, "title") || "未命名论文",
        link,
        abstract: cleanAbstract(childText(item, "description")),
        date: isValidDate(date) ? date : new Date(0),
        source: sourceLabel(getSource(item)),
      };
    });

    return {
      papers: deduplicatePapers(papers),
      lastBuildDate: new Date(childText(channel, "lastBuildDate")),
    };
  }

  function visiblePapers() {
    const query = state.query.toLocaleLowerCase();

    return state.papers.filter((paper) => {
      if (state.range === "today" && !isToday(paper.date)) {
        return false;
      }
      if (state.range === "7d" && !isWithinSevenDays(paper.date)) {
        return false;
      }
      if (state.source !== "all" && paper.source !== state.source) {
        return false;
      }

      if (!query) {
        return true;
      }

      return `${paper.title} ${paper.abstract} ${paper.source}`
        .toLocaleLowerCase()
        .includes(query);
    });
  }

  function setRange(range) {
    state.range = range;
    state.visibleCount = PAGE_SIZE;
    for (const button of elements.rangeButtons) {
      button.setAttribute("aria-pressed", String(button.dataset.range === range));
    }
    renderPapers();
  }

  function createPaperCard(paper, index) {
    const fragment = elements.template.content.cloneNode(true);
    const article = fragment.querySelector(".paper-card");
    const number = fragment.querySelector(".paper-index");
    const time = fragment.querySelector("time");
    const source = fragment.querySelector(".source-pill");
    const title = fragment.querySelector(".paper-title");
    const abstract = fragment.querySelector(".paper-abstract");
    const toggle = fragment.querySelector(".abstract-toggle");
    const link = fragment.querySelector(".paper-link");

    const displayNumber = String(index + 1).padStart(2, "0");
    const titleId = `paper-${paper.id.replace(/[^a-zA-Z0-9_-]/g, "-")}-${index}`;

    article.setAttribute("aria-labelledby", titleId);
    number.textContent = displayNumber;
    time.textContent = paperDateFormatter.format(paper.date);
    time.dateTime = paper.date.toISOString();
    source.textContent = paper.source;
    title.id = titleId;
    title.textContent = paper.title;
    title.href = paper.link || "#";
    abstract.textContent = paper.abstract || "该 RSS 条目暂未提供摘要。";
    link.href = paper.link || "#";

    if (!paper.abstract) {
      toggle.hidden = true;
    } else {
      toggle.addEventListener("click", () => {
        const expanded = toggle.getAttribute("aria-expanded") === "true";
        toggle.setAttribute("aria-expanded", String(!expanded));
        toggle.textContent = expanded ? "展开摘要" : "收起摘要";
        abstract.classList.toggle("is-expanded", !expanded);
      });
    }

    if (!paper.link) {
      title.removeAttribute("href");
      title.removeAttribute("target");
      link.hidden = true;
    }

    return fragment;
  }

  function renderEmptyState() {
    const container = document.createElement("div");
    const heading = document.createElement("h3");
    const description = document.createElement("p");

    container.className = "empty-state";
    heading.textContent = state.range === "today" ? "今天暂时没有新论文" : "没有找到匹配的论文";
    description.textContent = state.range === "today"
      ? "arXiv 在周末或非发布时段可能没有更新，可以切换到“近 7 天”继续浏览。"
      : "尝试缩短搜索词、选择其他分类，或者切换到“全部”。";
    container.append(heading, description);
    elements.list.append(container);
  }

  function renderPapers() {
    const filtered = visiblePapers();
    const displayed = filtered.slice(0, state.visibleCount);
    const fragment = document.createDocumentFragment();

    elements.list.replaceChildren();
    displayed.forEach((paper, index) => fragment.append(createPaperCard(paper, index)));
    elements.list.append(fragment);

    if (!filtered.length) {
      renderEmptyState();
    }

    elements.resultSummary.textContent = filtered.length
      ? `共 ${filtered.length} 篇，当前显示 ${displayed.length} 篇`
      : "0 篇结果";
    elements.loadMore.hidden = displayed.length >= filtered.length;
  }

  function updateStats(lastBuildDate) {
    const today = state.papers.filter((paper) => isToday(paper.date)).length;
    const week = state.papers.filter((paper) => isWithinSevenDays(paper.date)).length;
    const sources = new Set(state.papers.map((paper) => paper.source));

    elements.todayCount.textContent = String(today);
    elements.weekCount.textContent = String(week);
    elements.totalCount.textContent = String(state.papers.length);
    elements.sourceCount.textContent = String(sources.size);
    elements.updateLabel.textContent = isValidDate(lastBuildDate)
      ? `最近更新：${updateDateFormatter.format(lastBuildDate)}`
      : "RSS 已连接";

    state.range = today > 0 ? "today" : week > 0 ? "7d" : "all";
    for (const button of elements.rangeButtons) {
      button.setAttribute("aria-pressed", String(button.dataset.range === state.range));
    }
  }

  function updateSourceOptions() {
    const sources = [...new Set(state.papers.map((paper) => paper.source))]
      .filter(Boolean)
      .sort((left, right) => left.localeCompare(right));

    for (const source of sources) {
      const option = document.createElement("option");
      option.value = source;
      option.textContent = source;
      elements.sourceFilter.append(option);
    }
  }

  function setLoading(isLoading, message = "正在从 RSS 读取最新论文…") {
    elements.loadState.hidden = !isLoading;
    elements.loadMessage.textContent = message;
    elements.retryButton.hidden = true;
  }

  function setError() {
    elements.loadState.hidden = false;
    elements.loadMessage.textContent = "论文列表加载失败。请检查网络后重试。";
    elements.retryButton.hidden = false;
    elements.resultSummary.textContent = "加载失败";
    elements.updateLabel.textContent = "RSS 暂时无法连接";
  }

  async function loadFeed() {
    setLoading(true);
    try {
      const response = await fetch(`${FEED_URL}?v=${Date.now()}`, {
        cache: "no-store",
        headers: { Accept: "application/rss+xml, application/xml, text/xml" },
      });
      if (!response.ok) {
        throw new Error(`RSS 请求失败：${response.status}`);
      }

      const parsed = parseFeed(await response.text());
      state.papers = parsed.papers;
      state.visibleCount = PAGE_SIZE;
      state.source = "all";
      elements.sourceFilter.value = "all";
      elements.sourceFilter.querySelectorAll("option:not(:first-child)").forEach((option) => option.remove());
      updateStats(parsed.lastBuildDate);
      updateSourceOptions();
      setLoading(false);
      renderPapers();
    } catch (error) {
      console.error(error);
      setError();
    }
  }

  let searchTimer;
  elements.search.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      state.query = normalizeText(elements.search.value);
      state.visibleCount = PAGE_SIZE;
      renderPapers();
    }, 120);
  });

  elements.sourceFilter.addEventListener("change", () => {
    state.source = elements.sourceFilter.value;
    state.visibleCount = PAGE_SIZE;
    renderPapers();
  });

  for (const button of elements.rangeButtons) {
    button.addEventListener("click", () => setRange(button.dataset.range));
  }

  elements.loadMore.addEventListener("click", () => {
    state.visibleCount += PAGE_SIZE;
    renderPapers();
  });

  elements.retryButton.addEventListener("click", loadFeed);
  loadFeed();
})();
