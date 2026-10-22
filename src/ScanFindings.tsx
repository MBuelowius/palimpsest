import type { PackageScan } from "../server/scan";

const labels = {
  script: "Script or executable file",
  binary: "Binary file",
  "hidden-character": "Hidden characters",
  "download-and-run": "Download and run",
  "credential-path": "Credential path or keychain command",
};

export function ScanFindings({ scan }: { scan: PackageScan }) {
  return (
    <section className="review-notes scan-findings" aria-label="Static check">
      <h3>Static check</h3>
      {scan.findings.length ? (
        <>
          <p>Review these findings before adding this version.</p>
          <ul>
            {scan.findings.map((finding, index) => (
              <li key={index}>
                <span>{labels[finding.kind]}</span>
                {" · "}
                <code dir="ltr">
                  {finding.file}
                  {finding.line !== undefined && `:${finding.line}`}
                </code>
                {finding.detail && ` · ${finding.detail}`}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p>
          No scripts, binary files, hidden characters, download-and-run
          commands, or credential paths found by this static check.
        </p>
      )}
      {scan.truncated && (
        <p role="status">
          Showing the first {scan.findings.length} findings. The list is
          truncated.
        </p>
      )}
    </section>
  );
}
