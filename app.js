// PDF.js configuration
const pdfjsLib = window['pdfjs-dist/build/pdf'];
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// DOM Elements
const dropzone = document.getElementById('dropzone');
const pdfInput = document.getElementById('pdfInput');
const resultsSection = document.getElementById('resultsSection');
const resultsList = document.getElementById('resultsList');
const imageCountSpan = document.getElementById('imageCount');
const downloadAllBtn = document.getElementById('downloadAll');
const progressBar = document.getElementById('progressBar');
const progressFill = document.getElementById('progressFill');

let processedFiles = []; // All extracted data storage

// Interaction Event Listeners
dropzone.addEventListener('click', () => pdfInput.click());

dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
});

dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
});

dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
        handleFiles(Array.from(e.dataTransfer.files));
    }
});

pdfInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        handleFiles(Array.from(e.target.files));
    }
});

/**
 * Handle multiple PDF files
 */
async function handleFiles(files) {
    const pdfFiles = files.filter(f => f.type === 'application/pdf');
    if (pdfFiles.length === 0) {
        alert('Please provide valid PDF files.');
        return;
    }

    // Reset state for new upload
    processedFiles = [];
    resultsList.innerHTML = '';
    resultsSection.classList.add('hidden');
    progressFill.style.width = '0%';
    progressBar.classList.add('active');

    try {
        let totalProcessedImages = 0;

        for (let fileIndex = 0; fileIndex < pdfFiles.length; fileIndex++) {
            const file = pdfFiles[fileIndex];
            const baseFileName = file.name.replace(/\.[^/.]+$/, ""); // Name without extension
            const safeBaseName = sanitizeFileName(baseFileName);
            
            const arrayBuffer = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            
            let fileImages = [];
            let fullText = "";

            const totalPages = pdf.numPages;

            for (let i = 1; i <= totalPages; i++) {
                const page = await pdf.getPage(i);
                
                // --- Text Extraction ---
                const textContent = await page.getTextContent();
                let lastY;
                let pageText = "";
                
                for (const item of textContent.items) {
                    if (lastY !== undefined && Math.abs(item.transform[5] - lastY) > 5) {
                        pageText += "\n";
                    }
                    pageText += item.str;
                    lastY = item.transform[5];
                }
                fullText += `--- Page ${i} ---\n${pageText}\n\n`;

                // --- Image Extraction ---
                const opList = await page.getOperatorList();
                
                const overallPercent = ((fileIndex + (i / totalPages)) / pdfFiles.length) * 100;
                progressFill.style.width = `${overallPercent}%`;

                for (let j = 0; j < opList.fnArray.length; j++) {
                    const op = opList.fnArray[j];
                    const args = opList.argsArray[j];

                    if (op === pdfjsLib.OPS.paintImageXObject || op === pdfjsLib.OPS.paintInlineImageXObject) {
                        const imgId = args[0];
                        let imgSource;
                        
                        try {
                            imgSource = page.objs.get(imgId);
                        } catch (e) {
                            imgSource = page.commonObjs.get(imgId);
                        }

                        if (imgSource && (imgSource.data || imgSource.bitmap)) {
                            const blob = await imageToBlob(imgSource);
                            if (blob) {
                                const imgNum = fileImages.length + 1;
                                const imgName = `${safeBaseName}_${imgNum}.jpg`;
                                
                                fileImages.push({
                                    name: imgName,
                                    blob: blob
                                });
                                totalProcessedImages++;
                            }
                        }
                    }
                }
            }

            processedFiles.push({
                fileName: baseFileName,
                safeName: safeBaseName,
                fullName: file.name,
                images: fileImages,
                text: fullText
            });

            // Re-render UI section for this file
            if (fileImages.length > 0 || fullText.trim()) {
                const fileSection = document.createElement('div');
                fileSection.className = 'file-result-section';
                fileSection.innerHTML = `
                    <h3 class="file-section-title">${file.name}</h3>
                    <div class="file-content-container">
                        <div class="text-extraction-container ${fullText.trim() ? '' : 'hidden'}">
                            <div class="sub-header-row">
                                <h4 class="sub-title">Extracted Text:</h4>
                                <button class="btn btn-secondary btn-tiny copy-btn">Copy Text</button>
                            </div>
                            <div class="text-preview-box">${fullText.trim()}</div>
                        </div>
                        <div class="images-extraction-container ${fileImages.length > 0 ? '' : 'hidden'}">
                            <h4 class="sub-title">Images:</h4>
                            <div class="images-grid"></div>
                        </div>
                    </div>
                `;
                resultsList.appendChild(fileSection);
                
                // Copy logic
                const copyBtn = fileSection.querySelector('.copy-btn');
                if (copyBtn) {
                    copyBtn.addEventListener('click', () => {
                        navigator.clipboard.writeText(fullText.trim()).then(() => {
                            copyBtn.textContent = 'Copied!';
                            copyBtn.classList.add('success');
                            setTimeout(() => {
                                copyBtn.textContent = 'Copy Text';
                                copyBtn.classList.remove('success');
                            }, 2000);
                        });
                    });
                }

                if (fileImages.length > 0) {
                    const grid = fileSection.querySelector('.images-grid');
                    fileImages.forEach(img => {
                        const imgCard = createImageCard(img.blob, img.name);
                        grid.appendChild(imgCard);
                    });
                }
            }
        }

        if (totalProcessedImages > 0 || processedFiles.some(f => f.text.trim().length > 0)) {
            resultsSection.classList.remove('hidden');
            imageCountSpan.textContent = totalProcessedImages;
            resultsSection.scrollIntoView({ behavior: 'smooth' });
        } else {
            alert('No graphics or text found in the provided files.');
        }

    } catch (error) {
        console.error('Error processing PDF:', error);
        alert('An error occurred while analyzing the PDF files.');
    } finally {
        setTimeout(() => progressBar.classList.remove('active'), 1000);
    }
}

/**
 * Convert PDF image source to JPEG Blob
 */
async function imageToBlob(img) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    let width = img.width;
    let height = img.height;
    
    canvas.width = width;
    canvas.height = height;

    if (img.bitmap) {
        ctx.drawImage(img.bitmap, 0, 0);
    } else {
        const imageData = ctx.createImageData(width, height);
        if (img.data.length === width * height * 3) {
            for (let i = 0, j = 0; i < img.data.length; i += 3, j += 4) {
                imageData.data[j] = img.data[i];
                imageData.data[j+1] = img.data[i+1];
                imageData.data[j+2] = img.data[i+2];
                imageData.data[j+3] = 255;
            }
        } else if (img.data.length === width * height * 4) {
            imageData.data.set(img.data);
        } else {
            if (img.data.length === width * height) {
                for (let i = 0, j = 0; i < img.data.length; i++, j += 4) {
                    imageData.data[j] = img.data[i];
                    imageData.data[j+1] = img.data[i];
                    imageData.data[j+2] = img.data[i];
                    imageData.data[j+3] = 255;
                }
            } else {
                return null;
            }
        }
        ctx.putImageData(imageData, 0, 0);
    }

    return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
}

/**
 * Handle single file download correctly
 */
function downloadFile(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * Create image card with download button
 */
function createImageCard(blob, imgName) {
    const url = URL.createObjectURL(blob);
    const div = document.createElement('div');
    div.className = 'image-card';
    div.innerHTML = `
        <img src="${url}" alt="${imgName}">
        <div class="image-info">
            <span class="image-name" title="${imgName}">${imgName}</span>
            <button class="btn btn-primary btn-small download-btn">Download</button>
        </div>
    `;
    
    // Explicit download listener to ensure filename
    div.querySelector('.download-btn').addEventListener('click', () => {
        downloadFile(blob, imgName);
    });

    return div;
}

/**
 * Clean filename for file systems
 */
function sanitizeFileName(name) {
    const polishChars = {'ą':'a','ć':'c','ę':'e','ł':'l','ń':'n','ó':'o','ś':'s','ź':'z','ż':'z','Ą':'A','Ć':'C','Ę':'E','Ł':'L','Ń':'N','Ó':'O','Ś':'S','Ź':'Z','Ż':'Z'};
    let sanitized = name.split('').map(char => polishChars[char] || char).join('');
    sanitized = sanitized.replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_');
    return sanitized.replace(/^_+|_+$/g, '');
}

/**
 * Generate ZIP and trigger browser download
 */
downloadAllBtn.addEventListener('click', async () => {
    if (processedFiles.length === 0) return;

    downloadAllBtn.textContent = 'Compressing...';
    downloadAllBtn.disabled = true;

    try {
        const zip = new JSZip();
        const now = new Date();
        
        for (const fileData of processedFiles) {
            const folder = zip.folder(fileData.safeName);
            
            for (const img of fileData.images) {
                // To avoid base64 overhead in JSZip loop, convert blob back or use directly if using latest jszip
                const arrayBuffer = await img.blob.arrayBuffer();
                folder.file(img.name, arrayBuffer, { date: now });
            }

            if (fileData.text) {
                folder.file(`${fileData.safeName}_text.txt`, fileData.text, { date: now });
            }
        }

        const content = await zip.generateAsync({ 
            type: 'blob',
            mimeType: 'application/zip',
            compression: 'DEFLATE',
            compressionOptions: { level: 6 }
        });
        
        downloadFile(content, 'pdf_results.zip');
    } catch (e) {
        console.error(e);
        alert('Error creating ZIP archive.');
    } finally {
        downloadAllBtn.textContent = 'Download All (ZIP)';
        downloadAllBtn.disabled = false;
    }
});
