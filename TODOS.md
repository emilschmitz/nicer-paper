[x] fix the logic with deciding what domains to enable the extension for. 
  - I think the best solution would be to actually detect if it's a pdf. Chrome's native viewer must do sth like that.
    - The user would then be able to create patterns as white or black lists of domains, where he does/doesn't want the extension to be enabled.
[x] For debug and interest purposes, when we click on the extension, it should give some stats about what it's parsed.
[x] While it's parsing, when we click on the extension, there should be a progress bar. If that is not possible, make it a spinner.
[x] Sth is brittle. E.g. when i go on a local file PDF like "pdfs/2020_Denoising_Diffusion_Probabilistic_Models.pdf", I sometimes get the tooltip, sometimes no during same session. when i go on the exteions icon and click, it says 'inactive' for a split second, then switches to 'active'.