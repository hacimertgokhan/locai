import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./SystemToolbar.css";

interface BatteryInfo {
  level: number | null;
  is_charging: boolean;
}

interface MediaInfo {
  track_name: string | null;
  artist_name: string | null;
  app_name: string | null;
  is_playing: boolean;
}

export function SystemToolbar() {
  const [online, setOnline] = useState(navigator.onLine);
  const [battery, setBattery] = useState<BatteryInfo | null>(null);
  const [media, setMedia] = useState<MediaInfo | null>(null);
  const [showPopup, setShowPopup] = useState(false);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const fetchBattery = async () => {
    try {
      const bat: BatteryInfo = await invoke("get_mac_battery");
      setBattery(bat);
    } catch (e) {
      console.error("Battery fetch failed", e);
    }
  };

  const fetchMedia = async () => {
    try {
      const med: MediaInfo = await invoke("get_mac_media_info");
      setMedia(med);
    } catch (e) {
      console.error("Media info fetch failed", e);
    }
  };

  useEffect(() => {
    fetchBattery();
    fetchMedia();

    const batInterval = setInterval(fetchBattery, 60000);
    const medInterval = setInterval(fetchMedia, 3000);

    return () => {
      clearInterval(batInterval);
      clearInterval(medInterval);
    };
  }, []);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (showPopup && popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setShowPopup(false);
      }
    };
    if (showPopup) {
      window.addEventListener("mousedown", handleOutsideClick);
    }
    return () => window.removeEventListener("mousedown", handleOutsideClick);
  }, [showPopup]);

  const controlMedia = async (action: string) => {
    try {
      await invoke("control_mac_media", { action });
      setTimeout(fetchMedia, 500); // refresh quickly after action
    } catch (e) {
      console.error("Media control failed", e);
    }
  };

  return (
    <div className="sys-toolbar" style={{ display: "flex", alignItems: "center", marginLeft: "auto", gap: "12px", paddingRight: "16px", height: "100%", position: "relative" }}>
      
      {/* Network */}
      <div className="sys-item" title={online ? "Online" : "Offline"} style={{ color: online ? "var(--text-primary)" : "var(--git-deleted)", display: "flex", alignItems: "center" }}>
        {online ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 12.55a11 11 0 0 1 14.08 0"></path>
            <path d="M1.42 9a16 16 0 0 1 21.16 0"></path>
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path>
            <line x1="12" y1="20" x2="12.01" y2="20"></line>
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="1" y1="1" x2="23" y2="23"></line>
            <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"></path>
            <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"></path>
            <path d="M10.71 5.05A16 16 0 0 1 22.58 9"></path>
            <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"></path>
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path>
            <line x1="12" y1="20" x2="12.01" y2="20"></line>
          </svg>
        )}
      </div>

      {/* Battery */}
      {battery && battery.level !== null && (
        <div className="sys-item" title={`Battery: ${battery.level}% ${battery.is_charging ? "(Charging)" : ""}`} style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "11px", color: "var(--text-muted)" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="7" width="16" height="10" rx="2" ry="2"></rect>
            <line x1="22" y1="11" x2="22" y2="13"></line>
            {battery.is_charging && <polygon points="11 6 7 12 13 12 9 18" fill="currentColor" stroke="none"></polygon>}
          </svg>
          {!battery.is_charging && <span>{battery.level}%</span>}
        </div>
      )}

      {/* Media Player Icon (Always visible) */}
      <div 
        className="sys-item sys-media-trigger" 
        title={media?.track_name || "Media Player"} 
        onClick={(e) => { e.stopPropagation(); setShowPopup(!showPopup); }} 
        style={{ display: "flex", alignItems: "center", cursor: "pointer", color: media?.is_playing ? "var(--accent)" : "var(--text-muted)" }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M9 18V5l12-2v13"></path>
          <circle cx="6" cy="18" r="3"></circle>
          <circle cx="18" cy="16" r="3"></circle>
        </svg>
      </div>

      {/* Media Popup */}
      {showPopup && (
        <div ref={popupRef} className="sys-media-popup animate-slide-up" style={{ position: "absolute", bottom: "100%", right: 10, marginBottom: "12px", borderRadius: "16px", padding: "16px", width: "280px", zIndex: 10000, fontFamily: "var(--font-primary)" }}>
          
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
            <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.6)", textTransform: "uppercase", letterSpacing: "1px", fontWeight: 600 }}>
              {media?.app_name || "SYSTEM MEDIA"}
            </div>
            {media?.app_name && (
              <div className={`equalizer ${!media.is_playing ? 'eq-paused' : ''}`}>
                <div className="eq-bar"></div><div className="eq-bar"></div><div className="eq-bar"></div>
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: "16px", alignItems: "center", marginBottom: "20px" }}>
            <div className="sys-media-art">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5">
                <circle cx="12" cy="12" r="10"></circle>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "15px", fontWeight: "700", color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginBottom: "4px" }}>
                {media?.track_name || "No Track Playing"}
              </div>
              <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.6)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {media?.artist_name || "Open Spotify or Music"}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "center", gap: "24px", alignItems: "center", opacity: media?.app_name ? 1 : 0.4 }}>
            <button className="sys-media-btn" onClick={() => controlMedia("prev")} title="Previous">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="19 20 9 12 19 4 19 20"></polygon><line x1="5" y1="19" x2="5" y2="5"></line></svg>
            </button>
            <button className="sys-media-btn sys-media-play" onClick={() => controlMedia("playpause")} title={media?.is_playing ? "Pause" : "Play"}>
              {media?.is_playing ? (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"></rect><rect x="14" y="4" width="4" height="16" rx="1"></rect></svg>
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M5 3l14 9-14 9z"></path></svg>
              )}
            </button>
            <button className="sys-media-btn" onClick={() => controlMedia("next")} title="Next">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 4 15 12 5 20 5 4"></polygon><line x1="19" y1="5" x2="19" y2="19"></line></svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
