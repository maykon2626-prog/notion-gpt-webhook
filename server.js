const express = require("express");
const { Client } = require("@notionhq/client");
require("dotenv").config();

const app = express();
app.use(express.json());

const notion = new Client({ auth: process.env.NOTION_TOKEN });

// ─────────────────────────────────────────
// Middleware: autenticação via Bearer Token
// ─────────────────────────────────────────
app.use((req, res, next) => {
  const auth = req.headers["authorization"];
  if (!auth || auth !== `Bearer ${process.env.WEBHOOK_SECRET}`) {
    return res.status(401).json({ error: "Não autorizado." });
  }
  next();
});

// ─────────────────────────────────────────
// GET /search
// Busca páginas no Notion por texto
// Query: ?query=texto
// ─────────────────────────────────────────
app.get("/search", async (req, res) => {
  const { query } = req.query;
  if (!query) return res.status(400).json({ error: "Parâmetro 'query' obrigatório." });

  try {
    const response = await notion.search({
      query,
      filter: { value: "page", property: "object" },
      page_size: 5,
    });

    const results = response.results.map((page) => ({
      id: page.id,
      title: extractTitle(page),
      url: page.url,
      last_edited: page.last_edited_time,
    }));

    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────
// GET /page/:id
// Retorna o conteúdo completo de uma página
// ─────────────────────────────────────────
app.get("/page/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const [page, blocks] = await Promise.all([
      notion.pages.retrieve({ page_id: id }),
      notion.blocks.children.list({ block_id: id, page_size: 50 }),
    ]);

    const content = blocks.results
      .map((block) => extractBlockText(block))
      .filter(Boolean)
      .join("\n");

    res.json({
      id: page.id,
      title: extractTitle(page),
      url: page.url,
      last_edited: page.last_edited_time,
      content,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────
// GET /database/:id
// Lista entradas de um database do Notion
// Query: ?filter=texto (opcional)
// ─────────────────────────────────────────
app.get("/database/:id", async (req, res) => {
  const { id } = req.params;
  const { filter } = req.query;

  try {
    const payload = { database_id: id, page_size: 10 };

    if (filter) {
      payload.filter = {
        property: "Name",
        title: { contains: filter },
      };
    }

    const response = await notion.databases.query(payload);

    const results = response.results.map((page) => ({
      id: page.id,
      title: extractTitle(page),
      url: page.url,
      properties: simplifyProperties(page.properties),
      last_edited: page.last_edited_time,
    }));

    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────
function extractTitle(page) {
  const titleProp = Object.values(page.properties || {}).find(
    (p) => p.type === "title"
  );
  return titleProp?.title?.map((t) => t.plain_text).join("") || "Sem título";
}

function extractBlockText(block) {
  const richText = block[block.type]?.rich_text;
  if (!richText) return null;
  const text = richText.map((t) => t.plain_text).join("");
  const prefix = {
    heading_1: "# ",
    heading_2: "## ",
    heading_3: "### ",
    bulleted_list_item: "• ",
    numbered_list_item: "1. ",
    to_do: block.to_do?.checked ? "✅ " : "☐ ",
    quote: "> ",
    code: "```\n",
  };
  return (prefix[block.type] || "") + text;
}

function simplifyProperties(properties) {
  const result = {};
  for (const [key, prop] of Object.entries(properties)) {
    if (prop.type === "title") result[key] = prop.title?.map((t) => t.plain_text).join("");
    else if (prop.type === "rich_text") result[key] = prop.rich_text?.map((t) => t.plain_text).join("");
    else if (prop.type === "select") result[key] = prop.select?.name;
    else if (prop.type === "multi_select") result[key] = prop.multi_select?.map((s) => s.name);
    else if (prop.type === "date") result[key] = prop.date?.start;
    else if (prop.type === "number") result[key] = prop.number;
    else if (prop.type === "checkbox") result[key] = prop.checkbox;
    else if (prop.type === "url") result[key] = prop.url;
  }
  return result;
}

// ─────────────────────────────────────────
// Start
// ─────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Webhook rodando na porta ${PORT}`));
