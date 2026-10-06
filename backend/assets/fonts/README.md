# Fonts

`Cairo-Regular.ttf` is the Cairo variable font (default instance: Regular, 400),
distributed under the SIL Open Font License 1.1 (see `OFL.txt`). Invoice PDFs
currently render with DejaVu Sans from the `dejavu-fonts-ttf` dependency; this
file is kept as the bundled Cairo asset. `src/sales/cairo-font.spec.ts` guards
against it being replaced by a non-font file.
