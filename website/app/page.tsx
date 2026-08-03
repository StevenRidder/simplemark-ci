import Image from "next/image";

const githubUrl = "https://github.com/StevenRidder/simplemark";

function Brand({ footer = false }: { footer?: boolean }) {
  return (
    <a className={`brand${footer ? " brand--footer" : ""}`} href="#top" aria-label="SimpleMark home">
      <Image
        className="brand__mark"
        src="/brand/simplemark-logo-512.png"
        alt=""
        width={42}
        height={42}
        priority={!footer}
      />
      <span>SimpleMark</span>
    </a>
  );
}

function Arrow() {
  return <span aria-hidden="true">↗</span>;
}

function ProductWindow() {
  return (
    <div className="product-window" aria-label="SimpleMark current prototype demo">
      <div className="product-window__bar">
        <span className="traffic" aria-hidden="true"><i /><i /><i /></span>
        <span className="product-window__file">plan.md</span>
        <span className="product-window__state">Saved</span>
      </div>
      <Image
        className="product-window__demo"
        src="/product/simplemark-demo.gif"
        alt="The current SimpleMark prototype rendering Markdown, Mermaid, and SVG in one calm document canvas"
        width={760}
        height={475}
        unoptimized
        priority
      />
    </div>
  );
}

export default function Home() {
  return (
    <main id="top">
      <header className="site-header shell">
        <Brand />
        <nav className="desktop-nav" aria-label="Primary navigation">
          <a href="#why">Why SimpleMark</a>
          <a href="#how">How it works</a>
          <a href="#download">Download</a>
          <a className="nav-github" href={githubUrl} target="_blank" rel="noreferrer">
            GitHub <Arrow />
          </a>
        </nav>
        <details className="mobile-nav">
          <summary aria-label="Open navigation">Menu</summary>
          <div>
            <a href="#why">Why SimpleMark</a>
            <a href="#how">How it works</a>
            <a href="#download">Download</a>
            <a href={githubUrl} target="_blank" rel="noreferrer">GitHub <Arrow /></a>
          </div>
        </details>
      </header>

      <section className="hero shell">
        <div className="hero__copy">
          <div className="eyebrow"><span /> Pre-alpha for macOS</div>
          <h1>The beautiful living document for AI work.</h1>
          <p className="hero__lede">
            Your agent writes the Markdown. SimpleMark turns it into a document—always rendered,
            always your file.
          </p>
          <div className="hero__actions">
            <a className="button button--primary" href="#demo">See it in action <span aria-hidden="true">↓</span></a>
            <a className="button button--quiet" href={githubUrl} target="_blank" rel="noreferrer">View on GitHub <Arrow /></a>
          </div>
          <p className="hero__note">No vault. No account. No coding environment required to read.</p>
        </div>
        <div className="hero__visual" id="demo">
          <ProductWindow />
          <div className="floating-note floating-note--top"><b>Mermaid</b><span>renders inline</span></div>
          <div className="floating-note floating-note--bottom"><b>Local .md</b><span>stays portable</span></div>
        </div>
      </section>

      <section className="proof-bar" aria-label="SimpleMark principles">
        <div className="shell proof-bar__inner">
          <span>Beautiful by default</span><i />
          <span>Technical content inline</span><i />
          <span>Plain Markdown underneath</span>
        </div>
      </section>

      <section className="section shell" id="why">
        <div className="section-heading">
          <p className="kicker">The difference</p>
          <h2>A document, not another workspace.</h2>
          <p>
            SimpleMark is for reading and judging the Markdown your tools already create. The page
            stays in front; the machinery stays out of the way.
          </p>
        </div>

        <div className="before-after" aria-label="Markdown source becoming a rendered document">
          <div className="source-card">
            <div className="card-label"><span>What the agent writes</span><code>plan.md</code></div>
            <pre><code>{`# Rollout plan

Ship in three calm stages.

\`\`\`mermaid
flowchart LR
  Draft --> Review --> Ship
\`\`\`

| Gate | Proof |
| --- | --- |
| Readable | Human review |
| Portable | Markdown diff |`}</code></pre>
          </div>
          <div className="transform-mark" aria-hidden="true">→</div>
          <div className="render-card">
            <div className="card-label"><span>What you see</span><span className="live-pill">Rendered</span></div>
            <div className="rendered-paper">
              <h3>Rollout plan</h3>
              <p>Ship in three calm stages.</p>
              <div className="mini-flow"><span>Draft</span><b>→</b><span>Review</span><b>→</b><span>Ship</span></div>
              <table><thead><tr><th>Gate</th><th>Proof</th></tr></thead><tbody><tr><td>Readable</td><td>Human review</td></tr><tr><td>Portable</td><td>Markdown diff</td></tr></tbody></table>
            </div>
          </div>
        </div>

        <div className="feature-grid">
          <article>
            <span className="feature-number">01</span>
            <h3>Technical paste just works</h3>
            <p>Markdown, Mermaid, SVG, Graphviz, math, tables, and code belong on the same readable page.</p>
          </article>
          <article>
            <span className="feature-number">02</span>
            <h3>The file stays yours</h3>
            <p>SimpleMark is built around ordinary local Markdown and byte-preserving untouched source.</p>
          </article>
          <article>
            <span className="feature-number">03</span>
            <h3>Correct, then keep reading</h3>
            <p>Editing is contextual. Fix the exact sentence or block, then return to the rendered document.</p>
          </article>
        </div>
      </section>

      <section className="section section--paper" id="how">
        <div className="shell how-grid">
          <div className="section-heading section-heading--left">
            <p className="kicker">One quiet loop</p>
            <h2>From agent output to a document you can live in.</h2>
            <p>No import ceremony, provider setup, or permanent source view.</p>
          </div>
          <ol className="steps">
            <li><span>1</span><div><h3>Open the Markdown</h3><p>Choose the same local <code>.md</code> file your agent or tool created.</p></div></li>
            <li><span>2</span><div><h3>Read the real document</h3><p>Prose and technical blocks render together in one calm canvas.</p></div></li>
            <li><span>3</span><div><h3>Make a small correction</h3><p>Change only what needs fixing; keep everything else portable and untouched.</p></div></li>
          </ol>
        </div>
      </section>

      <section className="section shell current-proof">
        <div className="current-proof__visual">
          <div className="paper-stack" aria-hidden="true">
            <div className="paper-stack__back" />
            <div className="paper-stack__front">
              <Image src="/brand/simplemark-logo-512.png" alt="" width={78} height={78} />
              <span /> <span /> <span className="short" />
              <div className="paper-diagram"><i /><b>→</b><i /><b>→</b><i /></div>
            </div>
          </div>
        </div>
        <div className="current-proof__copy">
          <p className="kicker">Already working in the prototype</p>
          <h2>The hard parts are visible.</h2>
          <ul>
            <li>One rendered editing canvas</li>
            <li>Markdown, Mermaid, SVG, Graphviz, and math</li>
            <li>Editable portable tables and code highlighting</li>
            <li>Reader typography and quiet formatting controls</li>
            <li>Byte-fidelity tests for untouched source</li>
          </ul>
          <p className="honesty-note"><b>What is not ready:</b> a signed native download, production file watching, and the finished renderer-first product proof.</p>
        </div>
      </section>

      <section className="download shell" id="download">
        <Image className="download__mark" src="/brand/simplemark-logo-512.png" alt="" width={108} height={108} />
        <p className="kicker">Pre-alpha</p>
        <h2>Download SimpleMark.</h2>
        <p>The first signed macOS build is being prepared. Follow the repository now, and this page will become the simple download home when it is ready.</p>
        <div className="download__actions">
          <button className="button button--disabled" type="button" disabled>macOS build — coming soon</button>
          <a className="button button--quiet button--on-dark" href={githubUrl} target="_blank" rel="noreferrer">Follow the build <Arrow /></a>
        </div>
        <span className="download__meta">macOS first · Windows and Linux later · No account required</span>
      </section>

      <footer className="footer shell">
        <Brand footer />
        <p>Always rendered. Always your file.</p>
        <div><a href={githubUrl} target="_blank" rel="noreferrer">GitHub</a><a href="#top">Back to top ↑</a></div>
      </footer>
    </main>
  );
}
