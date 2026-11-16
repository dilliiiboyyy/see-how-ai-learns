import { useEffect, useState, useCallback } from 'react';
import { Search, Upload, X, Database, ShieldCheck, AlertCircle, ExternalLink } from 'lucide-react';
import { usePlatform } from '../context/PlatformContext';
import { tryUploadToFirebaseStorage } from '../lib/firebase';

interface DatasetImageItem {
  imageId: string;
  categoryId: string;
  categorySlug: string;
  categoryName: string;
  title: string;
  storagePath: string;
  thumbnailPath: string;
  url: string;
  thumbnailUrl: string;
  source: string;
  sourceUrl: string;
  license: string;
  width: number;
  height: number;
  format: string;
  sizeBytes: number;
  sha256: string;
  qualityScore: number;
  validationStatus: string;
  datasetType: 'built-in' | 'user' | 'autonomous';
  createdAt: string;
}

interface QualityReport {
  totalScanned: number;
  nearDuplicateCount: number;
  nearDuplicates: Array<{ imageA: string; imageB: string; category: string; distance: number }>;
  lowQualityCount: number;
  recommendations: Array<{ category: string; priority: string; reason: string }>;
  auditedAt: string;
}

export function ExplorePage() {
  const { firebaseStatus, refreshFirebaseStatus, sessionHeaders, beginInFlightOp, endInFlightOp } = usePlatform();

  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [datasetType, setDatasetType] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [images, setImages] = useState<DatasetImageItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [activeImage, setActiveImage] = useState<DatasetImageItem | null>(null);
  const [showDatasetInfo, setShowDatasetInfo] = useState(false);
  const [qualityReport, setQualityReport] = useState<QualityReport | null>(null);

  // Upload state
  const [uploadCatSlug, setUploadCatSlug] = useState('pens');
  const [uploadStatus, setUploadStatus] = useState('');
  const [uploading, setUploading] = useState(false);

  const fetchImages = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        category: selectedCategory,
        datasetType,
        search,
        page: String(page),
        limit: '24',
      });
      const res = await fetch(`/api/dataset/images?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setImages(data.images || []);
        setTotal(data.total || 0);
        setTotalPages(data.totalPages || 1);
      }
    } finally {
      setLoading(false);
    }
  }, [selectedCategory, datasetType, search, page]);

  useEffect(() => {
    void fetchImages();
  }, [fetchImages]);

  const loadQualityAudit = async () => {
    const res = await fetch('/api/dataset/quality');
    if (res.ok) {
      setQualityReport(await res.json());
    }
  };

  const handleToggleDatasetInfo = () => {
    const next = !showDatasetInfo;
    setShowDatasetInfo(next);
    if (next && !qualityReport) {
      void loadQualityAudit();
    }
  };

  const handleUploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadStatus('');
    let okCount = 0;
    let lastErr = '';

    for (const file of Array.from(files)) {
      beginInFlightOp();
      try {
        const form = new FormData();
        form.append('image', file);
        form.append('categorySlug', uploadCatSlug);
        const catObj = firebaseStatus?.categories.find((c) => c.slug === uploadCatSlug);
        form.append('categoryName', catObj?.name || uploadCatSlug);

        const res = await fetch('/api/dataset/upload', {
          method: 'POST',
          headers: sessionHeaders(),
          body: form,
        });
        const data = await res.json();
        if (res.ok && data.image) {
          okCount++;
          void tryUploadToFirebaseStorage(data.image.storagePath, file);
        } else {
          lastErr = data.error || 'Validation failed';
        }
      } finally {
        endInFlightOp();
      }
    }

    setUploading(false);
    if (okCount > 0) {
      setUploadStatus(`Added & validated ${okCount} shared library image(s) to ${uploadCatSlug}.`);
      await refreshFirebaseStatus();
      await fetchImages();
    } else {
      setUploadStatus(lastErr || 'Upload did not pass validation.');
    }
  };

  const categories = firebaseStatus?.categories || [];

  return (
    <div className="max-w-[1280px] mx-auto px-5 sm:px-8 py-12 space-y-10">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 border-b border-[#D9D3C8] pb-8">
        <div className="space-y-2 max-w-2xl">
          <p className="text-xs text-[#777469]">
            Explore Image Database
            <span className="mx-2" aria-hidden="true">·</span>
            <span className="tabular-nums">{firebaseStatus?.totalImages ?? 0} Validated Images</span>
            <span className="mx-2" aria-hidden="true">·</span>
            <span className="tabular-nums">{categories.length} Categories</span>
          </p>
          <h1 className="font-display text-3xl sm:text-4xl font-semibold text-[#292820]">
            Curated Everyday Object Library
          </h1>
          <p className="text-sm sm:text-base text-[#777469]">
            Browse legally reusable photographs across 12 everyday object categories. Every image is verified for resolution, sharpness, license attribution, and uniqueness.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleToggleDatasetInfo}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-md border border-[#D9D3C8] bg-[#FFFFFF] text-sm font-medium text-[#292820] hover:bg-[#E7E1D5]/60 cursor-pointer"
          >
            <Database className="w-4 h-4 text-[#777C61]" />
            {showDatasetInfo ? 'Hide Dataset Info' : 'Dataset & Firebase Info'}
          </button>
        </div>
      </div>

      {/* Dataset & Firebase Dashboard Panel */}
      {showDatasetInfo && (
        <section className="bg-[#FFFFFF] border border-[#D9D3C8] rounded-xl p-6 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#D9D3C8] pb-4">
            <div>
              <h2 className="font-display text-lg font-semibold text-[#292820]">
                Firebase Storage & Dataset Health
              </h2>
              <p className="text-xs text-[#777469] mt-0.5">
                {firebaseStatus?.storageDetail}
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadQualityAudit()}
              className="text-xs font-medium text-[#777C61] hover:underline cursor-pointer self-start"
            >
              Re-run Quality Audit
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 text-sm">
            <div className="bg-[#F4F1EA] rounded-lg p-3.5">
              <p className="text-xs text-[#777469]">Total Stored</p>
              <p className="font-display text-xl font-semibold text-[#292820] tabular-nums mt-1">
                {firebaseStatus?.totalImages ?? 0}
              </p>
            </div>
            <div className="bg-[#F4F1EA] rounded-lg p-3.5">
              <p className="text-xs text-[#777469]">Built-in</p>
              <p className="font-display text-xl font-semibold text-[#292820] tabular-nums mt-1">
                {firebaseStatus?.builtInCount ?? 0}
              </p>
            </div>
            <div className="bg-[#F4F1EA] rounded-lg p-3.5">
              <p className="text-xs text-[#777469]">User Uploaded</p>
              <p className="font-display text-xl font-semibold text-[#292820] tabular-nums mt-1">
                {firebaseStatus?.userCount ?? 0}
              </p>
            </div>
            <div className="bg-[#F4F1EA] rounded-lg p-3.5">
              <p className="text-xs text-[#777469]">Autonomous</p>
              <p className="font-display text-xl font-semibold text-[#292820] tabular-nums mt-1">
                {firebaseStatus?.autonomousCount ?? 0}
              </p>
            </div>
            <div className="bg-[#F4F1EA] rounded-lg p-3.5">
              <p className="text-xs text-[#777469]">Pending / Failed</p>
              <p className="font-display text-xl font-semibold text-[#292820] tabular-nums mt-1">
                {firebaseStatus?.pendingValidation ?? 0} / {firebaseStatus?.failedUploads ?? 0}
              </p>
            </div>
            <div className="bg-[#F4F1EA] rounded-lg p-3.5">
              <p className="text-xs text-[#777469]">Storage Size</p>
              <p className="font-display text-xl font-semibold text-[#292820] tabular-nums mt-1">
                {firebaseStatus?.storageUsageMB ?? 0} MB
              </p>
            </div>
          </div>

          {qualityReport && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-2 border-t border-[#D9D3C8]">
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-[#292820]">Dataset Quality Assistant</h3>
                <p className="text-xs text-[#777469]">
                  Scanned {qualityReport.totalScanned} images · Near-duplicates detected:{' '}
                  <span className="font-mono text-[#292820]">{qualityReport.nearDuplicateCount}</span> · Low-sharpness outliers:{' '}
                  <span className="font-mono text-[#292820]">{qualityReport.lowQualityCount}</span>
                </p>
              </div>
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-[#292820]">Training Recommendations</h3>
                <ul className="space-y-1.5">
                  {qualityReport.recommendations.slice(0, 3).map((rec, i) => (
                    <li key={i} className="text-xs text-[#777469]">
                      <span className="font-medium text-[#292820]">{rec.category}:</span> {rec.reason}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </section>
      )}

      {/* Category Overview Cards */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-[#292820]">Categories</h2>
          {selectedCategory !== 'all' && (
            <button
              type="button"
              onClick={() => {
                setSelectedCategory('all');
                setPage(1);
              }}
              className="text-xs font-medium text-[#777C61] hover:underline cursor-pointer"
            >
              Show all categories
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {categories.map((cat) => {
            const active = selectedCategory === cat.slug;
            const thumb = cat.previewImages?.[0]?.thumbnailUrl;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => {
                  setSelectedCategory(active ? 'all' : cat.slug);
                  setPage(1);
                }}
                className={`text-left rounded-lg border p-2.5 transition-colors cursor-pointer bg-[#FFFFFF] ${
                  active ? 'border-[#777C61] ring-2 ring-[#777C61]/20' : 'border-[#D9D3C8] hover:border-[#777C61]'
                }`}
              >
                <div className="aspect-[4/3] rounded bg-[#E7E1D5] overflow-hidden mb-2">
                  {thumb ? (
                    <img
                      src={thumb}
                      alt={cat.name}
                      referrerPolicy="no-referrer"
                      loading="lazy"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xs text-[#777469]">
                      No preview
                    </div>
                  )}
                </div>
                <p className="text-sm font-medium text-[#292820] truncate">{cat.name}</p>
                <p className="text-xs text-[#777469] font-mono tabular-nums mt-0.5">
                  {cat.imageCount} / {cat.targetCount}
                </p>
              </button>
            );
          })}
        </div>
      </section>

      {/* Search, Filter & Contribute Toolbar */}
      <section className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-[#E7E1D5]/55 border border-[#D9D3C8] rounded-xl p-4">
        <div className="flex flex-wrap items-center gap-3 flex-1">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="w-4 h-4 text-[#777469] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search titles, categories, licenses..."
              className="w-full pl-9 pr-3 py-2 text-sm rounded-md border border-[#D9D3C8] bg-[#FFFFFF] text-[#292820]"
            />
          </div>

          <div className="flex items-center gap-1 p-1 rounded-md bg-[#F4F1EA] border border-[#D9D3C8]">
            {(
              [
                ['all', 'All'],
                ['built-in', 'Built-in'],
                ['user', 'User'],
                ['autonomous', 'Autonomous'],
              ] as const
            ).map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => {
                  setDatasetType(val);
                  setPage(1);
                }}
                className={`px-3 py-1.5 text-xs font-medium rounded transition-colors cursor-pointer whitespace-nowrap ${
                  datasetType === val
                    ? 'bg-[#FFFFFF] text-[#292820] shadow-xs'
                    : 'text-[#777469] hover:text-[#292820]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Contribute Image Control */}
        <div className="flex flex-wrap items-center gap-2.5">
          <select
            value={uploadCatSlug}
            onChange={(e) => setUploadCatSlug(e.target.value)}
            aria-label="Category for uploaded image"
            className="px-3 py-2 text-sm rounded-md border border-[#D9D3C8] bg-[#FFFFFF] text-[#292820]"
          >
            {categories.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
          <label className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-[#777C61] text-[#FFFFFF] text-sm font-medium hover:bg-[#666B52] cursor-pointer whitespace-nowrap">
            <Upload className="w-4 h-4" />
            {uploading ? 'Validating...' : 'Add Image'}
            <input
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp"
              disabled={uploading}
              className="sr-only"
              onChange={(e) => {
                const files = e.target.files;
                if (files && files.length > 0) void handleUploadFiles(files);
                e.currentTarget.value = '';
              }}
            />
          </label>
        </div>
      </section>

      {uploadStatus && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-[#FFFFFF] border border-[#D9D3C8] text-sm text-[#292820]">
          <AlertCircle className="w-4 h-4 text-[#777C61] shrink-0" />
          <span>{uploadStatus}</span>
        </div>
      )}

      {/* Object Image Gallery */}
      <section className="space-y-6">
        <div className="flex items-center justify-between text-xs text-[#777469]">
          <span className="tabular-nums">
            Showing {images.length} of {total} validated images
          </span>
          <span className="tabular-nums">
            Page {page} of {totalPages}
          </span>
        </div>

        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="aspect-square rounded-lg bg-[#E7E1D5] animate-pulse" />
            ))}
          </div>
        ) : images.length === 0 ? (
          <div className="bg-[#FFFFFF] border border-[#D9D3C8] rounded-xl p-12 text-center space-y-2">
            <p className="text-base font-medium text-[#292820]">No images match these filters</p>
            <p className="text-sm text-[#777469]">Try clearing your search query or switching categories.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {images.map((item) => (
              <button
                key={item.imageId}
                type="button"
                onClick={() => setActiveImage(item)}
                className="group text-left bg-[#FFFFFF] border border-[#D9D3C8] rounded-lg overflow-hidden hover:border-[#777C61] transition-colors cursor-pointer"
              >
                <div className="aspect-square bg-[#E7E1D5] overflow-hidden">
                  <img
                    src={item.thumbnailUrl}
                    alt={item.title}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-200"
                  />
                </div>
                <div className="p-2.5 space-y-0.5">
                  <p className="text-xs font-medium text-[#292820] truncate">{item.categoryName}</p>
                  <p className="text-[11px] text-[#777469] truncate">{item.license}</p>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-3 pt-4">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="px-4 py-2 text-sm rounded-md border border-[#D9D3C8] bg-[#FFFFFF] text-[#292820] disabled:opacity-40 cursor-pointer"
            >
              Previous
            </button>
            <span className="text-sm text-[#777469] font-mono tabular-nums">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="px-4 py-2 text-sm rounded-md border border-[#D9D3C8] bg-[#FFFFFF] text-[#292820] disabled:opacity-40 cursor-pointer"
            >
              Next
            </button>
          </div>
        )}
      </section>

      {/* Individual Image Metadata Lightbox */}
      {activeImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#292820]/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={activeImage.title}
        >
          <div className="w-full max-w-3xl bg-[#F4F1EA] border border-[#D9D3C8] rounded-xl overflow-hidden grid grid-cols-1 md:grid-cols-2">
            <div className="bg-[#E7E1D5] flex items-center justify-center min-h-[260px]">
              <img
                src={activeImage.url}
                alt={activeImage.title}
                referrerPolicy="no-referrer"
                className="w-full h-full max-h-[440px] object-contain"
              />
            </div>
            <div className="p-6 flex flex-col justify-between space-y-5 bg-[#FFFFFF]">
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs text-[#777469]">
                      {activeImage.categoryName}
                      <span className="mx-1.5" aria-hidden="true">·</span>
                      <span className="capitalize">{activeImage.datasetType}</span>
                    </p>
                    <h3 className="font-display text-lg font-semibold text-[#292820] mt-0.5 break-words">
                      {activeImage.title}
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveImage(null)}
                    className="w-9 h-9 inline-flex items-center justify-center rounded-md text-[#777469] hover:text-[#292820] hover:bg-[#E7E1D5]/50 cursor-pointer shrink-0"
                    aria-label="Close image details"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <dl className="grid grid-cols-2 gap-y-2.5 gap-x-4 text-xs border-t border-[#D9D3C8] pt-4">
                  <div>
                    <dt className="text-[#777469]">Dimensions</dt>
                    <dd className="font-mono text-[#292820] tabular-nums mt-0.5">
                      {activeImage.width} × {activeImage.height} px
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[#777469]">Quality Score</dt>
                    <dd className="font-mono text-[#292820] tabular-nums mt-0.5">
                      {(activeImage.qualityScore * 100).toFixed(0)}%
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[#777469]">Source</dt>
                    <dd className="text-[#292820] mt-0.5">{activeImage.source}</dd>
                  </div>
                  <div>
                    <dt className="text-[#777469]">License</dt>
                    <dd className="text-[#292820] mt-0.5">{activeImage.license}</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-[#777469]">Storage Path</dt>
                    <dd className="font-mono text-[11px] text-[#292820] break-all mt-0.5">
                      {activeImage.storagePath}
                    </dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-[#777469]">Verification</dt>
                    <dd className="inline-flex items-center gap-1.5 text-[#777C61] font-medium mt-0.5">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      {activeImage.validationStatus} · SHA-256 {activeImage.sha256.slice(0, 12)}...
                    </dd>
                  </div>
                </dl>
              </div>

              {activeImage.sourceUrl && (
                <a
                  href={activeImage.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-[#777C61] hover:underline"
                >
                  View original source & attribution
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
