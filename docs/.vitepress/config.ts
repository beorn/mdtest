import { defineConfig } from "vitepress"
import llmstxt from "vitepress-plugin-llms"
import { seoHead, seoTransformPageData } from "@bearly/vitepress-enrich"

const seoOptions = {
  hostname: "https://beorn.codes/mdspec",
  siteName: "mdspec",
  description: "Markdown-driven test runner",
  ogImage: "https://beorn.codes/mdspec/og-image.svg",
  author: "Bjørn Stabell",
  codeRepository: "https://github.com/beorn/mdspec",
}

export default defineConfig({
  title: "mdspec",
  description: "Write tests in markdown. Run them as code.",
  base: "/mdspec/",
  lastUpdated: true,

  sitemap: { hostname: "https://beorn.codes/mdspec/" },

  vite: {
    plugins: [llmstxt()],
    ssr: {
      noExternal: ["@bearly/vitepress-enrich"],
    },
  },

  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: "/mdspec/favicon.svg" }],
    [
      "script",
      {
        defer: "",
        src: "https://static.cloudflareinsights.com/beacon.min.js",
        "data-cf-beacon": '{"token": "d9b13df1eca0424c884faea71f34e09f"}',
      },
    ],
    ...seoHead(seoOptions),
  ],

  transformPageData: seoTransformPageData(seoOptions),

  themeConfig: {
    nav: [
      { text: "Guide", link: "/guide/getting-started" },
      { text: "Reference", link: "/reference/cli" },
    ],
    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Getting Started", link: "/guide/getting-started" },
          { text: "Pattern Matching", link: "/guide/pattern-matching" },
          { text: "Persistent Context", link: "/guide/persistent-context" },
          { text: "Plugins", link: "/guide/plugins" },
          { text: "Custom Commands", link: "/guide/custom-commands" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "CLI", link: "/reference/cli" },
          { text: "API", link: "/reference/api" },
          { text: "Block Options", link: "/reference/block-options" },
        ],
      },
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/beorn/mdspec" }],
    footer: {
      message:
        'Used by <a href="https://silvery.dev">Silvery</a> and <a href="https://termless.dev">Termless</a> for executable documentation',
      copyright: 'Built by <a href="https://beorn.codes">Bjørn Stabell</a>',
    },
    search: { provider: "local" },
  },
})
