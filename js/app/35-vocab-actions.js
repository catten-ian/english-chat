/* ============================================================
   生词本事件绑定，由 js/app.js 拆分而来
============================================================ */
registerAction('add-vocab-manual', function () { addVocabManual(); });
registerAction('import-vocab', function () { importVocab(); });
registerAction('save-vocab-import', function () { saveVocabImport(); });
registerAction('edit-vocab', function () { addVocabManual(+this.getAttribute('data-arg1')); });
registerAction('save-vocab-editor', function () { saveVocabEditor(+this.getAttribute('data-arg1')); });
registerAction('vocab-add-sense', function () { vocabAddSenseRow(); });
registerAction('vocab-remove-sense', function () { vocabRemoveSenseRow(this); });
registerAction('show-vocab-detail', function () { showVocabDetail(+this.getAttribute('data-arg1')); });
registerAction('clear-all-vocab', function () { clearAllVocab(); });
