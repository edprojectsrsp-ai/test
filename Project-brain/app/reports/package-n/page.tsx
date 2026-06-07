'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Edit3, Eye, Printer, Save, Download } from 'lucide-react';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

interface ProjectSection {
  id: string;
  title: string;
  content: string;
  progress?: string;
  financial?: string;
}

export default function PackageNReport() {
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [dirty, setDirty] = useState(false);
  const pageRef = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState(1);

  // Structured Data (Much better than raw HTML string)
  const [reportData, setReportData] = useState<ProjectSection[]>([
    {
      id: '1',
      title: '1. Rebuilding of COB#2',
      content: 'Stage-1 approval: 30.05.2019\nStage-1 Cost - Rs. 356.31 Crs...',
      progress: '99.75%',
      financial: 'Achieved till Mar’26: Rs 461.41 Cr (106.43%)'
    },
    // Add all other projects here...
    {
      id: '2',
      title: '2. Installation Of 4th Slab Caster...',
      content: 'Stage-I approval: 30.05.2019...',
      progress: 'Commissioned',
      financial: 'Achieved: 960.52 Cr (86.91%)'
    },
    // ... you can add all 18 projects
  ]);

  const [title, setTitle] = useState("PACKAGE - N");
  const [subtitle, setSubtitle] = useState("Status of Ongoing Projects as on 29.05.2026");

  // Auto scale to fit A4
  useEffect(() => {
    const fitToA4 = () => {
      if (!pageRef.current) return;
      const containerWidth = window.innerWidth - 80;
      const contentWidth = 794; // A4 width in px at 96dpi
      setFitScale(Math.min(1, containerWidth / contentWidth));
    };

    fitToA4();
    window.addEventListener('resize', fitToA4);
    return () => window.removeEventListener('resize', fitToA4);
  }, []);

  const handlePrint = () => {
    window.print();
  };

  const handleExportPDF = async () => {
    if (!pageRef.current) return;
    
    const canvas = await html2canvas(pageRef.current, { scale: 2 });
    const imgData = canvas.toDataURL('image/png');
    
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    const pdfWidth = pdf.internal.pageSize.getWidth();
    const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

    pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
    pdf.save(`RSP_Package_N_Report_${new Date().toISOString().slice(0,10)}.pdf`);
  };

  const updateSection = (id: string, field: keyof ProjectSection, value: string) => {
    setReportData(prev => prev.map(section =>
      section.id === id ? { ...section, [field]: value } : section
    ));
    setDirty(true);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Toolbar */}
      <div className="sticky top-0 z-50 bg-white border-b shadow-sm">
        <div className="max-w-5xl mx-auto px-6 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Package-N Status Report</h1>
            <p className="text-sm text-gray-500">Rourkela Steel Plant • Live Editor</p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setMode(mode === 'view' ? 'edit' : 'view')}
              className="flex items-center gap-2 px-5 py-2.5 border rounded-xl hover:bg-gray-100 transition"
            >
              {mode === 'view' ? <Edit3 size={18} /> : <Eye size={18} />}
              {mode === 'view' ? 'Edit Mode' : 'View Mode'}
            </button>

            <button
              onClick={handlePrint}
              className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition"
            >
              <Printer size={18} /> Print
            </button>

            <button
              onClick={handleExportPDF}
              className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition"
            >
              <Download size={18} /> Export PDF
            </button>

            {dirty && (
              <button className="flex items-center gap-2 px-5 py-2.5 bg-amber-600 text-white rounded-xl">
                <Save size={18} /> Save
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Document */}
      <div className="flex justify-center p-8">
        <div className="doc-container">
          <div
            ref={pageRef}
            className="doc-page bg-white shadow-2xl"
            style={{ transform: `scale(${fitScale})`, transformOrigin: 'top left' }}
          >
            <div className="p-[18mm] min-h-[297mm] text-[11pt] leading-relaxed font-serif">
              <h1 className="text-center text-[14pt] font-bold mb-2">{title}</h1>
              <h2 className="text-center text-[12pt] mb-8 text-gray-700">{subtitle}</h2>

              {reportData.map((section) => (
                <div key={section.id} className="mb-8">
                  <h3 className="font-bold text-[12pt] mb-3">{section.title}</h3>
                  
                  {mode === 'edit' ? (
                    <textarea
                      className="w-full h-32 p-3 border border-gray-300 rounded-lg font-serif text-[11pt]"
                      value={section.content}
                      onChange={(e) => updateSection(section.id, 'content', e.target.value)}
                    />
                  ) : (
                    <div className="whitespace-pre-line text-[11pt]">
                      {section.content}
                    </div>
                  )}

                  {section.progress && (
                    <p className="mt-2"><strong>Progress:</strong> {section.progress}</p>
                  )}
                  {section.financial && (
                    <p><strong>Financial:</strong> {section.financial}</p>
                  )}
                </div>
              ))}

              {/* Highlights */}
              <div className="mt-12 pt-8 border-t text-center text-[10.5pt] italic">
                <strong>Highlights:</strong><br />
                1. CAPEX FY2025-26 - Target RE- Rs 2152.5 Cr., Achieved- Rs 2155.44 Cr. (100.14%)<br />
                2. Battery 7 Refractory First brick laid on 20.04.2026<br />
                3. 1000 Safe mandays achieved on 01.05.2026
              </div>
            </div>
          </div>
        </div>
      </div>

      <style jsx global>{`
        .doc-container {
          width: 210mm;
          max-width: 100%;
        }
        .doc-page {
          width: 210mm;
          min-height: 297mm;
          box-shadow: 0 25px 50px -12px rgb(0 0 0 / 0.25);
        }
        @media print {
          .doc-container, .doc-page { box-shadow: none; transform: none !important; }
          @page { size: A4; margin: 0; }
        }
      `}</style>
    </div>
  );
}