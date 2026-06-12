# Citation Extraction Evaluation: Known Problems & Failure Modes

This document details the recurring failure modes observed during the pipeline evaluation on the ground truth dataset (excluding URL equivalence/DOI-arXiv mismatches, which are handled programmatically).

---

## 1. Segmentation Failures (Under- and Over-Segmentation)

PDF layout parsing can result in incorrect text block boundaries, which breaks the mapping between inline citation text and target URLs:

### Under-Segmentation (Block Merging)
* **What happens:** Tightly packed bibliography entries (often by the same authors) are grouped into a single large text block instead of distinct references.
* **Impact:** The resolver only extracts the first URL it successfully parses within the block. Subsequent citations merged in the same block fail to resolve their correct URLs, leading to `mismatch` or `unmatched` results.
* **Example:**
  ```text
  [1] Author A. First Paper. 2020. URL_A.
  [2] Author A. Second Paper. 2021. URL_B.
  ```
  Both are parsed as a single block. Only `URL_A` is extracted, leaving `[2]` unmatched or incorrectly linked.

### Over-Segmentation (Block Splitting)
* **What happens:** A single citation is split across two text blocks (e.g., due to page boundaries, columns, or line spacing).
* **Impact:** The text matcher matches the ground truth to the first block (containing the authors/title), but the actual identifier or URL lies in the second block. The resolver returns `null` for the first block, causing a `miss`.

---

## 2. Identifier Line-Wrapping
* **What happens:** Long identifiers (such as DOIs or arXiv URLs) span across line wraps in the PDF's references layout.
* **Impact:** The regex parser is line-oriented and only captures the fragment on the first line, failing validation.
* **Example:**
  * **Text in PDF:** `doi: 10.1177/\n2053951718819569`
  * **Captured:** `10.1177/` (invalid prefix fragment, resulting in a `miss`).

---

## 3. Bare Identifiers (Missing Prefixes)
* **What happens:** References list arXiv IDs or DOIs as plain text numbers without standard prefixes like `arXiv:`, `arXiv preprint`, or `doi:`.
* **Impact:** The parser fails to match them because the heuristic regexes require the explicit indicator prefix.
* **Example:**
  * **Text in PDF:** `Training very deep networks. 1507.06228, 2015.`
  * **Result:** The bare ID `1507.06228` is missed.
