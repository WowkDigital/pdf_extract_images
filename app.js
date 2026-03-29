// Konfiguracja PDF.js
const pdfjsLib = window['pdfjs-dist/build/pdf'];
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Elementy DOM
const dropzone = document.getElementById('dropzone');
const pdfInput = document.getElementById('pdfInput');
const resultsSection = document.getElementById('resultsSection');
const resultsList = document.getElementById('resultsList');
const imageCountSpan = document.getElementById('imageCount');
const downloadAllBtn = document.getElementById('downloadAll');
const progressBar = document.getElementById('progressBar');
const progressFill = document.getElementById('progressFill');

let processedFiles = []; // Przechowuje wyniki dla wszystkich przetworzonych plików

// Obsługa interakcji z uploadem
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

async function handleFiles(files) {
    const pdfFiles = files.filter(f => f.type === 'application/pdf');
    if (pdfFiles.length === 0) {
        alert('Podaj poprawne pliki PDF.');
        return;
    }

    // Reset stanu lub dopisanie
    processedFiles = [];
    resultsList.innerHTML = '';
    resultsSection.classList.add('hidden');
    progressFill.style.width = '0%';
    progressBar.classList.add('active');

    try {
        let totalProcessedImages = 0;

        for (let fileIndex = 0; fileIndex < pdfFiles.length; fileIndex++) {
            const file = pdfFiles[fileIndex];
            const baseFileName = file.name.replace(/\.[^/.]+$/, ""); // Nazwa bez rozszerzenia
            const safeBaseName = sanitizeFileName(baseFileName);

            const arrayBuffer = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            
            let fileImages = [];
            let fullText = "";

            const totalPages = pdf.numPages;

            for (let i = 1; i <= totalPages; i++) {
                const page = await pdf.getPage(i);
                
                // --- Ekstrakcja tekstu ---
                const textContent = await page.getTextContent();
                const pageText = textContent.items.map(item => item.str).join(" ");
                fullText += `--- Strona ${i} ---\n${pageText}\n\n`;

                // --- Ekstrakcja obrazów ---
                const opList = await page.getOperatorList();
                
                // Progres (uproszczony dla wielu plików)
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
                            const dataUrl = await imageToDataUrl(imgSource);
                            if (dataUrl) {
                                const imgNum = fileImages.length + 1;
                                // Uproszczona nazwa bez spacji i długich ciągów
                                const imgName = `img_${imgNum}.jpg`;
                                
                                fileImages.push({
                                    name: imgName,
                                    url: dataUrl
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

            // Dodaj sekcję dla tego pliku
            if (fileImages.length > 0) {
                const fileSection = document.createElement('div');
                fileSection.className = 'file-result-section';
                fileSection.innerHTML = `
                    <h3 class="file-section-title">${file.name}</h3>
                    <div class="images-grid"></div>
                `;
                resultsList.appendChild(fileSection);
                
                const grid = fileSection.querySelector('.images-grid');
                fileImages.forEach(img => {
                    const imgCard = createImageCard(img.url, img.name);
                    grid.appendChild(imgCard);
                });
            }
        }

        if (totalProcessedImages > 0 || processedFiles.some(f => f.text.trim().length > 0)) {
            resultsSection.classList.remove('hidden');
            imageCountSpan.textContent = totalProcessedImages;
            resultsSection.scrollIntoView({ behavior: 'smooth' });
        } else {
            alert('Nie znaleziono grafik ani tekstu w przesłanych plikach.');
        }

    } catch (error) {
        console.error('Błąd podczas przetwarzania PDF:', error);
        alert('Wystąpił błąd podczas analizy plików PDF.');
    } finally {
        setTimeout(() => progressBar.classList.remove('active'), 1000);
    }
}

async function imageToDataUrl(img) {
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

    return canvas.toDataURL('image/jpeg', 0.85); // Zmiana na JPEG dla lepszej kompatybilności systemowej
}

function createImageCard(url, imgName) {
    const div = document.createElement('div');
    div.className = 'image-card';
    div.innerHTML = `
        <img src="${url}" alt="${imgName}">
        <div class="image-info">
            <div>
                <span class="image-name">${imgName}</span>
            </div>
            <a href="${url}" download="${imgName}" class="btn btn-primary btn-small">Pobierz</a>
        </div>
    `;
    return div;
}

function sanitizeFileName(name) {
    // Mapowanie polskich znaków
    const polishChars = {'ą':'a','ć':'c','ę':'e','ł':'l','ń':'n','ó':'o','ś':'s','ź':'z','ż':'z','Ą':'A','Ć':'C','Ę':'E','Ł':'L','Ń':'N','Ó':'O','Ś':'S','Ź':'Z','Ż':'Z'};
    
    let sanitized = name.split('').map(char => polishChars[char] || char).join('');
    
    // Usuń znaki niebezpieczne dla systemów plików i potencjalnie groźne dla Windows Defender
    // Zamień spacje na podkreślenia, usuń kropki (z wyjątkiem rozszerzenia, ale tu operujemy na baseName)
    sanitized = sanitized.replace(/[^a-z0-9]/gi, '_').replace(/_+/g, '_');
    
    // Usuń podkreślenia z początku i końca
    return sanitized.replace(/^_+|_+$/g, '');
}

downloadAllBtn.addEventListener('click', async () => {
    if (processedFiles.length === 0) return;

    downloadAllBtn.textContent = 'Kompresowanie...';
    downloadAllBtn.disabled = true;

    try {
        const zip = new JSZip();
        
        for (const fileData of processedFiles) {
            // Używamy bezpiecznej nazwy folderu
            const folder = zip.folder(fileData.safeName);
            
            // Dodaj obrazy do folderu
            for (const img of fileData.images) {
                const base64Data = img.url.split(',')[1];
                folder.file(img.name, base64Data, { base64: true });
            }

            // Dodaj wyeksportowany tekst
            if (fileData.text) {
                folder.file(`${fileData.safeName}_tekst.txt`, fileData.text);
            }
        }

        const content = await zip.generateAsync({ 
            type: 'blob',
            compression: 'DEFLATE',
            compressionOptions: { level: 6 }
        });
        const downloadUrl = URL.createObjectURL(content);
        
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = 'pdf_results.zip';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(downloadUrl);
    } catch (e) {
        console.error(e);
        alert('Błąd podczas tworzenia archiwum ZIP.');
    } finally {
        downloadAllBtn.textContent = 'Pobierz wszystkie (ZIP)';
        downloadAllBtn.disabled = false;
    }
});
