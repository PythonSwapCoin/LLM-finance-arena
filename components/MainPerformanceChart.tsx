import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import type { Agent, Benchmark } from '../types';
import { INITIAL_CASH } from '../constants';
import { formatTimestampToDate } from '../utils/timeFormatting';
import { getAgentDisplayName } from '../utils/modelNameFormatter';
import {
  MARKET_OPEN_MINUTES,
  formatEtDate,
  formatEtTime,
  getEtDayKey,
  getEtMinutes,
  isWithinMarketHoursSeconds,
  normalizeTimestampToUnixSeconds
} from '../utils/marketTime';

type Participant = Agent | Benchmark;

interface MainPerformanceChartProps {
  participants: Participant[];
  startDate?: string;
  currentDate?: string;
  simulationMode?: 'simulated' | 'realtime' | 'historical' | 'hybrid';
  day?: number;
  intradayHour?: number;
  simulationTypeName?: string;
}

const CustomTooltip = ({
  active,
  payload,
  label,
  selectedParticipantId,
  startDate,
  currentDate,
  simulationMode,
  day,
  intradayHour,
  simulationTypeName,
  participants
}: any) => {
  if (active && payload && payload.length) {
    const timeLabel = formatTimestampToDate(label, startDate, currentDate, simulationMode, day, intradayHour);
    
    // If a participant is selected, only show that one; otherwise show all
    const filteredPayload = selectedParticipantId 
      ? payload.filter((pld: any) => pld.dataKey === selectedParticipantId)
      : payload;
    const numericPayload = filteredPayload.filter((pld: any) => typeof pld.value === 'number' && Number.isFinite(pld.value));
    
    return (
      <div className="bg-arena-surface p-4 rounded-md border border-arena-border shadow-lg">
        <p className="label text-arena-text-primary font-semibold">{timeLabel}</p>
        <div className="mt-2 space-y-1">
          {numericPayload.sort((a: any, b: any) => b.value - a.value).map((pld: any, idx: number) => {
            // Get the participant to check if it's an agent or benchmark
            const participant = participants?.find((p: any) => p.id === pld.dataKey);
            const displayName = participant && 'model' in participant
              ? getAgentDisplayName(participant as Agent, simulationTypeName)
              : pld.name;
            return (
              <div key={`tooltip-${pld.dataKey}-${idx}`} style={{ color: pld.color }} className="text-sm flex justify-between space-x-4">
                <span>{displayName}:</span>
                <span className="font-mono font-semibold">${pld.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }
  return null;
};

// Custom dot component that shows logo at the last point
const CustomDot = (props: any) => {
  // Extract key and other props separately to avoid React key warning
  // Note: 'key' is a special React prop and shouldn't be destructured
  const { cx, cy, payload, dataKey, index, data, image } = props;
  
  // Only render logo at the last data point
  if (index !== data.length - 1) return null;
  if (!image) return null;

  // Make logos twice as big: 40x40 instead of 20x20, radius 24 instead of 12
  const logoSize = 40;
  const radius = 24;

  return (
    <g>
      <defs>
        <clipPath id={`dot-logo-clip-${dataKey}-${index}`}>
          <circle cx={cx} cy={cy} r={radius} />
        </clipPath>
      </defs>
      {/* White circle background for better visibility */}
      <circle cx={cx} cy={cy} r={radius} fill="white" opacity="0.9" />
      {/* Logo image - twice as big */}
      <image
        href={image}
        x={cx - logoSize / 2}
        y={cy - logoSize / 2}
        width={logoSize}
        height={logoSize}
        clipPath={`url(#dot-logo-clip-${dataKey}-${index})`}
        style={{ filter: `drop-shadow(0 2px 4px rgb(0 0 0 / 0.4))` }}
        onError={(e) => {
          // Hide image if it fails to load
          (e.target as SVGImageElement).style.display = 'none';
        }}
      />
      {/* Border circle */}
      <circle cx={cx} cy={cy} r={radius} fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth={1} />
    </g>
  );
};

const EndOfLineLabel = ({ points, data, color, name, isBenchmark }: any) => {
  if (!points || points.length === 0 || !data || data.length === 0) return null;

  const lastPoint = points[points.length - 1];
  const { x, y } = lastPoint;
  const value = data[data.length - 1].totalValue;

  return (
    <g transform={`translate(${x + 8}, ${y - 10})`} style={{ pointerEvents: 'none' }}>
      <rect
        height="22"
        width={name.length * 8 + 65}
        fill={color}
        rx="4"
        style={{ filter: `drop-shadow(0 1px 1px rgb(0 0 0 / 0.5))`, pointerEvents: 'none' }}
      />
      <text x="5" y="15" fill="#fff" fontSize="12px" fontWeight={isBenchmark ? "normal" : "bold"} style={{ pointerEvents: 'none' }}>
        {name}
      </text>
      <text x={name.length * 8 + 5} y="15" fill="#fff" fontSize="12px" fontWeight="normal" opacity="0.8" style={{ pointerEvents: 'none' }}>
        ${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}
      </text>
    </g>
  );
};


type TimePeriod = '24h' | '1w' | 'all';

type AxisMeta = {
  timestamps: number[];
  dayKeys: string[];
  dayIndices: number[];
  totalDays: number;
  showEveryNDays: number;
  isGapIndices: Set<number>;
};

const MARKET_OPEN_LABEL_WINDOW_MINUTES = 45;

// Helper function to format X-axis labels for market hours
const formatXAxisLabel = (
  timestamp: number,
  index: number,
  axisMeta: AxisMeta,
  timePeriod?: TimePeriod
): string => {
  if (!Number.isFinite(timestamp) || axisMeta.isGapIndices.has(index)) {
    return '';
  }

  const date = new Date(timestamp * 1000);
  const dayKey = axisMeta.dayKeys[index];
  const prevDayKey = index > 0 ? axisMeta.dayKeys[index - 1] : null;
  const isNewDay = dayKey !== prevDayKey;
  const isFirstPoint = index === 0;
  const minutes = getEtMinutes(date);
  const isMarketOpen = minutes >= MARKET_OPEN_MINUTES
    && minutes < (MARKET_OPEN_MINUTES + MARKET_OPEN_LABEL_WINDOW_MINUTES);

  const showHoursOnly = timePeriod === '24h' || axisMeta.totalDays <= 1;

  if (showHoursOnly) {
    if (isNewDay && (isMarketOpen || isFirstPoint || timePeriod === '24h')) {
      return `${formatEtDate(date)} ${formatEtTime(date)}`;
    }
    if (minutes % 60 === 0) {
      return formatEtTime(date);
    }
    return '';
  }

  if (isNewDay && (isMarketOpen || isFirstPoint)) {
    const dayIndex = axisMeta.dayIndices[index];
    if (dayIndex % axisMeta.showEveryNDays === 0 || isFirstPoint || index === axisMeta.timestamps.length - 1) {
      return formatEtDate(date);
    }
  }

  return '';
};


// Helper function to determine which ticks should be shown based on available space
const getVisibleTickIndices = (
  chartData: any[],
  containerWidth: number,
  axisMeta: AxisMeta,
  timePeriod?: TimePeriod
): Set<number> => {
  if (chartData.length === 0 || containerWidth === 0) {
    return new Set();
  }

  const visibleIndices = new Set<number>();
  const estimatedLabelWidth = 60; // Estimated width of a label in pixels (e.g., "14:30" or "Nov 10")
  
  // First, determine which indices have labels
  const indicesWithLabels: number[] = [];
  chartData.forEach((d, idx) => {
    const label = formatXAxisLabel(
      d.timestamp as number,
      idx,
      axisMeta,
      timePeriod
    );
    if (label) {
      indicesWithLabels.push(idx);
    }
  });

  if (indicesWithLabels.length === 0) {
    return new Set();
  }

  // Calculate available width (accounting for margins)
  // Estimate chart width: container width minus margins (left: 10-20, right: 170-56 depending on viewport)
  // Use a conservative estimate
  const chartWidth = Math.max(200, containerWidth - 200);
  
  // Calculate spacing between data points
  const dataPointSpacing = chartData.length > 1 ? chartWidth / (chartData.length - 1) : chartWidth;
  
  // Only show ticks if there's enough space for labels
  // Check if the spacing between labels would be sufficient
  if (indicesWithLabels.length > 1) {
    // Estimate the minimum spacing needed between visible ticks
    // Need enough space for label + padding on both sides
    const minSpacingNeeded = estimatedLabelWidth + 20; // label width + padding
    
    // Start with the first label
    let lastVisibleIndex = indicesWithLabels[0];
    visibleIndices.add(indicesWithLabels[0]);
    
    // Iterate through remaining labels
    for (let i = 1; i < indicesWithLabels.length; i++) {
      const currentIndex = indicesWithLabels[i];
      const spacing = (currentIndex - lastVisibleIndex) * dataPointSpacing;
      
      // Only add if there's enough space since the last visible tick
      if (spacing >= minSpacingNeeded) {
        visibleIndices.add(currentIndex);
        lastVisibleIndex = currentIndex;
      }
    }
    
    // Always try to show the last label if it's different from the last visible one
    const lastIndex = indicesWithLabels[indicesWithLabels.length - 1];
    if (!visibleIndices.has(lastIndex) && lastIndex !== lastVisibleIndex) {
      // Check if we can fit it (relaxed threshold for last label)
      const spacingToLast = (lastIndex - lastVisibleIndex) * dataPointSpacing;
      if (spacingToLast >= minSpacingNeeded * 0.6) {
        visibleIndices.add(lastIndex);
      }
    }
  } else if (indicesWithLabels.length === 1) {
    // Only one label, always show it
    visibleIndices.add(indicesWithLabels[0]);
  }

  return visibleIndices;
};

export const MainPerformanceChart: React.FC<MainPerformanceChartProps> = ({ 
  participants,
  startDate,
  currentDate,
  simulationMode,
  day,
  intradayHour,
  simulationTypeName
}) => {
  const [selectedParticipantId, setSelectedParticipantId] = useState<string | null>(null);
  const [hoveredParticipantId, setHoveredParticipantId] = useState<string | null>(null);
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('all');
  
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>(0);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const observer = new ResizeObserver(entries => {
      if (entries[0]) {
        setContainerWidth(entries[0].contentRect.width);
      }
    });

    observer.observe(containerRef.current);

    return () => observer.disconnect();
  }, []);

  const fallbackWidth = typeof window !== 'undefined' ? window.innerWidth : 0;
  const effectiveWidth = containerWidth || fallbackWidth;
  const isCompactViewport = effectiveWidth !== 0 && effectiveWidth < 640;

  const chartMargin = useMemo(
    () =>
      isCompactViewport
        ? { top: 15, right: 56, left: 6, bottom: 12 }
        : { top: 15, right: 170, left: 10, bottom: 5 },
    [isCompactViewport]
  );

  const { chartData, yAxisDomain } = useMemo(() => {
    if (!participants || !participants.length || !participants[0] || !participants[0].performanceHistory || participants[0].performanceHistory.length === 0) {
      return { chartData: [], yAxisDomain: ['auto', 'auto'] };
    }

    const visibleParticipants = selectedParticipantId
      ? participants.filter(p => p.id === selectedParticipantId)
      : participants;

    const seriesByParticipant = new Map<string, Array<{ timestamp: number; value: number }>>();
    const timestampSet = new Set<number>();

    visibleParticipants.forEach(p => {
      if (!p.performanceHistory || !Array.isArray(p.performanceHistory)) {
        return;
      }

      const series = p.performanceHistory
        .map(metric => {
          const normalized = normalizeTimestampToUnixSeconds(metric.timestamp, startDate);
          if (normalized === null || !Number.isFinite(normalized)) {
            return null;
          }
          return { timestamp: normalized, value: metric.totalValue };
        })
        .filter((point): point is { timestamp: number; value: number } => point !== null)
        .sort((a, b) => a.timestamp - b.timestamp);

      if (series.length === 0) {
        return;
      }

      seriesByParticipant.set(p.id, series);
      series.forEach(point => timestampSet.add(point.timestamp));
    });

    let timestamps = Array.from(timestampSet).sort((a, b) => a - b);
    timestamps = timestamps.filter(ts => isWithinMarketHoursSeconds(ts));

    if (timestamps.length === 0) {
      return { chartData: [], yAxisDomain: ['auto', 'auto'] };
    }

    if (timePeriod === '24h') {
      const latest = timestamps[timestamps.length - 1];
      const cutoff = latest - (24 * 60 * 60);
      timestamps = timestamps.filter(ts => ts >= cutoff);
    } else if (timePeriod === '1w') {
      const dayKeys = new Set<string>();
      for (let i = timestamps.length - 1; i >= 0; i -= 1) {
        dayKeys.add(getEtDayKey(new Date(timestamps[i] * 1000)));
        if (dayKeys.size >= 5) {
          break;
        }
      }
      timestamps = timestamps.filter(ts => dayKeys.has(getEtDayKey(new Date(ts * 1000))));
    }

    if (timestamps.length === 0) {
      return { chartData: [], yAxisDomain: ['auto', 'auto'] };
    }

    const diffs: number[] = [];
    for (let i = 1; i < timestamps.length; i += 1) {
      const diff = timestamps[i] - timestamps[i - 1];
      if (diff > 0) {
        diffs.push(diff);
      }
    }
    const sortedDiffs = diffs.slice().sort((a, b) => a - b);
    const medianDiff = sortedDiffs.length > 0 ? sortedDiffs[Math.floor(sortedDiffs.length / 2)] : 0;
    const maxCarrySeconds = Math.max(medianDiff * 2.5, 5 * 60);

    const timeline: Array<{ timestamp: number; isGap: boolean }> = timestamps.map(timestamp => ({
      timestamp,
      isGap: false,
    }));

    let minValue = Infinity;
    let maxValue = -Infinity;

    const data: Array<Record<string, any>> = [];
    const seriesIndices = new Map<string, number>();

    timeline.forEach(entry => {
      const row: Record<string, any> = { timestamp: entry.timestamp, isGap: entry.isGap };

      visibleParticipants.forEach(p => {
        if (entry.isGap) {
          row[p.id] = null;
          return;
        }

        const series = seriesByParticipant.get(p.id) ?? [];
        let idx = seriesIndices.get(p.id) ?? 0;
        while (idx < series.length && series[idx].timestamp <= entry.timestamp) {
          idx += 1;
        }
        seriesIndices.set(p.id, idx);

        const candidate = idx > 0 ? series[idx - 1] : null;
        if (candidate && entry.timestamp - candidate.timestamp <= maxCarrySeconds) {
          row[p.id] = candidate.value;
          minValue = Math.min(minValue, candidate.value);
          maxValue = Math.max(maxValue, candidate.value);
        } else {
          row[p.id] = null;
        }
      });

      if (!selectedParticipantId) {
        row['initial-capital'] = INITIAL_CASH;
        minValue = Math.min(minValue, INITIAL_CASH);
        maxValue = Math.max(maxValue, INITIAL_CASH);
      }

      data.push(row);
    });

    const safeMin = Number.isFinite(minValue) ? minValue : INITIAL_CASH;
    const safeMax = Number.isFinite(maxValue) ? maxValue : INITIAL_CASH;
    const range = safeMax - safeMin;
    let domain: [number, number];

    if (timePeriod === '24h' || timePeriod === '1w') {
      const paddingPercent = 0.08;
      const padding = Math.max(50, range * paddingPercent);
      const center = (safeMin + safeMax) / 2;
      const totalRange = range + (padding * 2);
      domain = [
        Math.max(0, center - totalRange / 2),
        center + totalRange / 2
      ];
    } else {
      const padding = Math.max(50, range * 0.05);
      domain = [
        Math.max(0, safeMin - padding),
        safeMax + padding
      ];
    }

    return { chartData: data, yAxisDomain: domain };
  }, [participants, selectedParticipantId, startDate, timePeriod]);

  const axisMeta = useMemo<AxisMeta>(() => {
    const timestamps = chartData.map(point => point.timestamp as number);
    const dayKeys: string[] = [];
    const dayIndices: number[] = [];
    const isGapIndices = new Set<number>();

    let lastDayKey: string | null = null;
    let dayIndex = -1;

    chartData.forEach((point, idx) => {
      if (point?.isGap) {
        isGapIndices.add(idx);
      }
      const date = new Date(timestamps[idx] * 1000);
      const dayKey = getEtDayKey(date);
      dayKeys[idx] = dayKey;
      if (dayKey !== lastDayKey) {
        dayIndex += 1;
        lastDayKey = dayKey;
      }
      dayIndices[idx] = Math.max(dayIndex, 0);
    });

    const totalDays = Math.max(dayIndex + 1, 0);
    const showEveryNDays = totalDays <= 10 ? 1 : totalDays <= 30 ? 2 : 5;

    return {
      timestamps,
      dayKeys,
      dayIndices,
      totalDays,
      showEveryNDays,
      isGapIndices
    };
  }, [chartData]);

  const dayBoundaries = useMemo(() => {
    if (chartData.length === 0) {
      return [];
    }

    const boundaries: number[] = [];
    let lastDayKey: string | null = null;

    chartData.forEach((_, idx) => {
      if (axisMeta.isGapIndices.has(idx)) {
        return;
      }
      const timestamp = axisMeta.timestamps[idx];
      const date = new Date(timestamp * 1000);
      const dayKey = axisMeta.dayKeys[idx];
      const isFirstPoint = idx === 0;
      const minutes = getEtMinutes(date);
      const isMarketOpen = minutes >= MARKET_OPEN_MINUTES
        && minutes < (MARKET_OPEN_MINUTES + MARKET_OPEN_LABEL_WINDOW_MINUTES);

      if (dayKey !== lastDayKey && (isMarketOpen || isFirstPoint)) {
        const dayIndex = axisMeta.dayIndices[idx];
        if (timePeriod === '24h' || axisMeta.totalDays <= 1 || isFirstPoint || dayIndex % axisMeta.showEveryNDays === 0) {
          boundaries.push(timestamp);
        }
      }
      lastDayKey = dayKey;
    });

    return boundaries;
  }, [chartData, axisMeta, timePeriod]);

  // Calculate which ticks should be visible based on available space
  const visibleTickIndices = useMemo(() => {
    return getVisibleTickIndices(
      chartData,
      effectiveWidth,
      axisMeta,
      timePeriod
    );
  }, [chartData, effectiveWidth, axisMeta, timePeriod]);

  // Create array of timestamps that should have ticks (only those with visible labels)
  const visibleTickTimestamps = useMemo(() => {
    return chartData
      .map((d, idx) => visibleTickIndices.has(idx) ? d.timestamp as number : null)
      .filter((ts): ts is number => ts !== null);
  }, [chartData, visibleTickIndices]);

  if (chartData.length === 0) {
    return <div className="flex items-center justify-center h-full text-arena-text-secondary">Awaiting simulation data...</div>;
  }

  // Separate participants into benchmarks and agents for legend
  const benchmarks = participants.filter(p =>
    (p as Benchmark).name === "AI Managers Index" || (p as Benchmark).name === "S&P 500"
  );
  const agents = participants.filter(p =>
    (p as Benchmark).name !== "AI Managers Index" && (p as Benchmark).name !== "S&P 500"
  );

  return (
    <div ref={containerRef} className="relative w-full flex flex-col" style={{ gap: '12px' }}>
      {/* Time Period Selector */}
      <div className="flex items-center gap-2 justify-end">
        <span className="text-xs text-arena-text-tertiary uppercase tracking-wider">Time Period:</span>
        <div className="flex gap-1 bg-arena-surface/50 rounded-md border border-arena-border/50 p-1">
          <button
            onClick={() => setTimePeriod('24h')}
            className={`px-3 py-1.5 text-sm font-medium rounded transition-all ${
              timePeriod === '24h'
                ? 'bg-arena-surface text-arena-text-primary shadow-sm'
                : 'text-arena-text-secondary hover:text-arena-text-primary hover:bg-arena-surface/50'
            }`}
          >
            24h
          </button>
          <button
            onClick={() => setTimePeriod('1w')}
            className={`px-3 py-1.5 text-sm font-medium rounded transition-all ${
              timePeriod === '1w'
                ? 'bg-arena-surface text-arena-text-primary shadow-sm'
                : 'text-arena-text-secondary hover:text-arena-text-primary hover:bg-arena-surface/50'
            }`}
          >
            1 Week
          </button>
          <button
            onClick={() => setTimePeriod('all')}
            className={`px-3 py-1.5 text-sm font-medium rounded transition-all ${
              timePeriod === 'all'
                ? 'bg-arena-surface text-arena-text-primary shadow-sm'
                : 'text-arena-text-secondary hover:text-arena-text-primary hover:bg-arena-surface/50'
            }`}
          >
            All Time
          </button>
        </div>
      </div>
      
      {selectedParticipantId && (() => {
        const selected = participants.find(p => p.id === selectedParticipantId);
        const displayName = selected && 'model' in selected
          ? getAgentDisplayName(selected as Agent, simulationTypeName)
          : selected?.name || 'Selected';
        return (
          <div className="absolute top-2 right-2 z-10 bg-arena-surface px-3 py-1 rounded-md border border-arena-border text-xs text-arena-text-secondary">
            Showing: {displayName}
            <span className="ml-2 text-arena-text-tertiary">(Click to deselect)</span>
          </div>
        );
      })()}
      <div 
        style={{ width: '100%', height: '400px', minHeight: '400px', minWidth: '200px', position: 'relative' }}
        className="focus:outline-none"
        tabIndex={-1}
      >
        <ResponsiveContainer width="100%" height={400} minHeight={400}>
      <LineChart
        data={chartData}
        margin={chartMargin}
        onClick={(e) => {
          // If clicking on chart background (not a line), deselect
          if (selectedParticipantId && !e?.activePayload?.length) {
            setSelectedParticipantId(null);
          }
        }}
        style={{ cursor: hoveredParticipantId ? 'pointer' : 'default', outline: 'none' }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#262626" vertical={false} />
        <Tooltip
          content={(props) => (
            <CustomTooltip
              {...props}
              selectedParticipantId={selectedParticipantId}
              startDate={startDate}
              currentDate={currentDate}
              simulationMode={simulationMode}
              day={day}
              intradayHour={intradayHour}
              simulationTypeName={simulationTypeName}
              participants={participants}
            />
          )}
        />
        {/* Day boundary reference lines (dotted vertical lines) - show at beginning of each day */}
        {dayBoundaries.map((boundary, idx) => (
          <ReferenceLine
            key={`day-boundary-${idx}`}
            x={boundary}
            stroke="#A3A3A3"
            strokeDasharray="4 4"
            strokeWidth={1.5}
            opacity={0.7}
          />
        ))}
        <XAxis 
          dataKey="timestamp" 
          stroke="#A3A3A3"
          ticks={visibleTickTimestamps}
          tick={(props: any) => {
            const { x, y, payload } = props;

            const payloadValue = Number(payload.value);
            if (!Number.isFinite(payloadValue)) return null;

            const dataIndex = axisMeta.timestamps.findIndex(ts => Math.abs(ts - payloadValue) < 1);
            if (dataIndex === -1 || axisMeta.isGapIndices.has(dataIndex) || !visibleTickIndices.has(dataIndex)) {
              return null;
            }

            const label = formatXAxisLabel(payloadValue, dataIndex, axisMeta, timePeriod);
            if (!label) return null;

            return (
              <g transform={`translate(${x},${y})`}>
                <text
                  x={0}
                  y={0}
                  dy={16}
                  textAnchor="middle"
                  fill="#A3A3A3"
                  fontSize={12}
                >
                  {label}
                </text>
              </g>
            );
          }}
          tickLine={(props: any) => {
            // Only show tick line if this timestamp is in the visible set
            const timestamp = props.payload?.value ?? props.value;
            if (timestamp === undefined) return null;
            
            const numericTimestamp = Number(timestamp);
            if (!Number.isFinite(numericTimestamp)) return null;

            if (!visibleTickTimestamps.some(ts => Math.abs(ts - numericTimestamp) < 1)) {
              return null;
            }

            const dataIndex = axisMeta.timestamps.findIndex(ts => Math.abs(ts - numericTimestamp) < 1);
            if (dataIndex === -1 || axisMeta.isGapIndices.has(dataIndex) || !visibleTickIndices.has(dataIndex)) {
              return null;
            }

            const label = formatXAxisLabel(numericTimestamp, dataIndex, axisMeta, timePeriod);
            if (!label) return null;
            return <line {...props} />;
          }}
          minTickGap={60}
        />
        <YAxis
          stroke="#A3A3A3"
          tick={{ fill: '#A3A3A3', fontSize: 12 }}
          tickFormatter={(value: number) => `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          domain={yAxisDomain}
          width={80}
        />
        
        {/* Initial Capital line - only show if no participant is selected, or dimmed if hovering */}
        {!selectedParticipantId && (
          <Line 
              isAnimationActive={false}
              dataKey={() => INITIAL_CASH} 
              stroke="#737373" 
              strokeWidth={1.5} 
              strokeDasharray="5 5" 
              dot={false}
              name="Initial Capital"
              opacity={hoveredParticipantId ? 0.2 : 1}
          />
        )}

        {/* Render benchmarks first (behind agents) so markers appear on top */}
        {participants
          .filter(p => !selectedParticipantId || selectedParticipantId === p.id)
          .filter(p => (p as Benchmark).name === "AI Managers Index" || (p as Benchmark).name === "S&P 500")
          .map((p, index) => {
            const isHovered = hoveredParticipantId === p.id;
            const isSelected = selectedParticipantId === p.id;
            const opacity = selectedParticipantId && !isSelected ? 0 : (hoveredParticipantId && !isHovered ? 0.15 : 1);
            const strokeWidth = isHovered || isSelected
              ? ((p as Benchmark).name === "AI Managers Index" ? 5 : 4)
              : ((p as Benchmark).name === "AI Managers Index" ? 3 : 2.5);

            return (
              <React.Fragment key={`benchmark-${p.id}-${index}`}>
                {/* Invisible thicker line for better hover/click detection */}
                <Line
                  type="linear"
                  dataKey={p.id}
                  stroke="transparent"
                  strokeWidth={20}
                  dot={false}
                  activeDot={false}
                  isAnimationActive={false}
                  connectNulls={false}
                  onMouseEnter={() => setHoveredParticipantId(p.id)}
                  onMouseLeave={() => setHoveredParticipantId(null)}
                  onClick={(e) => {
                    e?.stopPropagation?.();
                    if (selectedParticipantId === p.id) {
                      setSelectedParticipantId(null);
                    } else {
                      setSelectedParticipantId(p.id);
                    }
                  }}
                />
                {/* Visible line */}
                <Line
                  type="linear"
                  dataKey={p.id}
                  stroke={p.color}
                  strokeWidth={strokeWidth}
                  strokeDasharray={(p as Benchmark).name === "S&P 500" ? "3 3" : "0"}
                  dot={false}
                  activeDot={{
                    r: isHovered || isSelected ? 8 : 5,
                    strokeWidth: 2,
                    stroke: '#ffffff',
                    fill: p.color,
                    style: { cursor: 'pointer', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))' }
                  }}
                  isAnimationActive={false}
                  connectNulls={false}
                  name={p.name}
                  opacity={opacity}
                  style={{ pointerEvents: 'none' }}
                  label={
                    !isCompactViewport && p.performanceHistory && p.performanceHistory.length > 0 ? (
                      <EndOfLineLabel
                        data={p.performanceHistory}
                        color={p.color}
                        name={p.name}
                        isBenchmark={(p as any).name.includes('Index') || (p as any).name.includes('S&P')}
                      />
                    ) : undefined
                  }
                />
              </React.Fragment>
            );
          })}

        {/* Render agents after benchmarks (so markers appear on top) */}
        {participants
          .filter(p => !selectedParticipantId || selectedParticipantId === p.id)
          .filter(p => (p as Benchmark).name !== "AI Managers Index" && (p as Benchmark).name !== "S&P 500")
          .map((p, index) => {
            const isHovered = hoveredParticipantId === p.id;
            const isSelected = selectedParticipantId === p.id;
            const opacity = selectedParticipantId && !isSelected ? 0 : (hoveredParticipantId && !isHovered ? 0.15 : 1);
            const strokeWidth = isHovered || isSelected ? 4 : 2.5;
            // Get display name for agents (formatted model name for Wall Street Arena)
            const displayName = getAgentDisplayName(p as Agent, simulationTypeName);

            return (
              <React.Fragment key={`agent-${p.id}-${index}`}>
                {/* Invisible thicker line for better hover/click detection */}
                <Line
                  type="linear"
                  dataKey={p.id}
                  stroke="transparent"
                  strokeWidth={20}
                  dot={false}
                  activeDot={false}
                  isAnimationActive={false}
                  connectNulls={false}
                  onMouseEnter={() => setHoveredParticipantId(p.id)}
                  onMouseLeave={() => setHoveredParticipantId(null)}
                  onClick={(e) => {
                    e?.stopPropagation?.();
                    if (selectedParticipantId === p.id) {
                      setSelectedParticipantId(null);
                    } else {
                      setSelectedParticipantId(p.id);
                    }
                  }}
                />
                {/* Visible line */}
                <Line
                  type="linear"
                  dataKey={p.id}
                  stroke={p.color}
                  strokeWidth={strokeWidth}
                  strokeDasharray="0"
                  dot={(props) => {
                    const { key, ...restProps } = props;
                    return <CustomDot key={key} {...restProps} data={chartData} image={(p as Agent).image} />;
                  }}
                  activeDot={{
                    r: isHovered || isSelected ? 8 : 5,
                    strokeWidth: 2,
                    stroke: '#ffffff',
                    fill: p.color,
                    style: { cursor: 'pointer', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))' }
                  }}
                  isAnimationActive={false}
                  connectNulls={false}
                  name={displayName}
                  opacity={opacity}
                  style={{ pointerEvents: 'none' }}
                  label={
                    !isCompactViewport && p.performanceHistory && p.performanceHistory.length > 0 ? (
                      <EndOfLineLabel
                        data={p.performanceHistory}
                        color={p.color}
                        name={displayName}
                        isBenchmark={(p as any).name.includes('Index') || (p as any).name.includes('S&P')}
                      />
                    ) : undefined
                  }
                />
              </React.Fragment>
            );
          })}
      </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Interactive Legend */}
      {!isCompactViewport && (
        <div className="flex flex-wrap gap-3 px-2 py-3 bg-arena-surface/50 rounded-md border border-arena-border/50">
          {/* Benchmarks section */}
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs text-arena-text-tertiary uppercase tracking-wider mr-1">Benchmarks:</span>
            {benchmarks.map((p, index) => {
              const isHovered = hoveredParticipantId === p.id;
              const isSelected = selectedParticipantId === p.id;
              const isDimmed = (hoveredParticipantId && !isHovered) || (selectedParticipantId && !isSelected);

              return (
                <button
                  key={`benchmark-legend-${p.id}-${index}`}
                  onClick={() => {
                    if (selectedParticipantId === p.id) {
                      setSelectedParticipantId(null);
                    } else {
                      setSelectedParticipantId(p.id);
                    }
                  }}
                  onMouseEnter={() => setHoveredParticipantId(p.id)}
                  onMouseLeave={() => setHoveredParticipantId(null)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-md transition-all ${
                    isSelected
                      ? 'bg-arena-surface shadow-md'
                      : isHovered
                      ? 'bg-arena-surface/80 shadow-sm'
                      : 'bg-arena-surface/40 hover:bg-arena-surface/60'
                  }`}
                  style={{
                    border: '1px solid',
                    borderColor: isSelected || isHovered ? p.color : 'rgba(38, 38, 38, 0.5)',
                    opacity: isDimmed ? 0.3 : 1,
                  }}
                >
                  <div
                    className="w-6 h-0.5 rounded-full"
                    style={{
                      backgroundColor: p.color,
                      ...(((p as Benchmark).name === "S&P 500") && {
                        backgroundImage: `repeating-linear-gradient(90deg, ${p.color} 0, ${p.color} 3px, transparent 3px, transparent 6px)`,
                        backgroundColor: 'transparent'
                      })
                    }}
                  />
                  <span className="text-sm font-semibold" style={{ color: p.color }}>
                    {p.name}
                  </span>
                  {p.performanceHistory && p.performanceHistory.length > 0 && (
                    <span className="text-xs text-arena-text-secondary font-mono">
                      ${p.performanceHistory[p.performanceHistory.length - 1].totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Divider */}
          {agents.length > 0 && benchmarks.length > 0 && (
            <div className="w-px h-8 bg-arena-border/50" />
          )}

          {/* Agents section */}
          {agents.length > 0 && (
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-xs text-arena-text-tertiary uppercase tracking-wider mr-1">Agents:</span>
              {agents.map((p, index) => {
                const isHovered = hoveredParticipantId === p.id;
                const isSelected = selectedParticipantId === p.id;
                const isDimmed = (hoveredParticipantId && !isHovered) || (selectedParticipantId && !isSelected);
                // Get display name for agents (formatted model name for Wall Street Arena)
                const displayName = getAgentDisplayName(p as Agent, simulationTypeName);

                return (
                  <button
                    key={`agent-legend-${p.id}-${index}`}
                    onClick={() => {
                      if (selectedParticipantId === p.id) {
                        setSelectedParticipantId(null);
                      } else {
                        setSelectedParticipantId(p.id);
                      }
                    }}
                    onMouseEnter={() => setHoveredParticipantId(p.id)}
                    onMouseLeave={() => setHoveredParticipantId(null)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-md transition-all ${
                      isSelected
                        ? 'bg-arena-surface shadow-md'
                        : isHovered
                        ? 'bg-arena-surface/80 shadow-sm'
                        : 'bg-arena-surface/40 hover:bg-arena-surface/60'
                    }`}
                    style={{
                      border: '1px solid',
                      borderColor: isSelected || isHovered ? p.color : 'rgba(38, 38, 38, 0.5)',
                      opacity: isDimmed ? 0.3 : 1,
                    }}
                  >
                    {(p as Agent).image && (
                      <img
                        src={(p as Agent).image}
                        alt={displayName}
                        className="w-5 h-5 rounded-full object-cover"
                        style={{ boxShadow: `0 0 0 1px ${p.color}` }}
                      />
                    )}
                    <div className="w-6 h-0.5 rounded-full" style={{ backgroundColor: p.color }} />
                    <span className="text-sm font-semibold" style={{ color: p.color }}>
                      {displayName}
                    </span>
                    {p.performanceHistory && p.performanceHistory.length > 0 && (
                      <span className="text-xs text-arena-text-secondary font-mono">
                        ${p.performanceHistory[p.performanceHistory.length - 1].totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
