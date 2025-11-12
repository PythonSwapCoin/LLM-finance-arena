import React, { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import type { Agent, Benchmark } from '../types';
import { INITIAL_CASH } from '../constants';
import { formatTimestampToDate } from '../utils/timeFormatting';

type Participant = Agent | Benchmark;

interface MainPerformanceChartProps {
  participants: Participant[];
  startDate?: string;
  currentDate?: string;
  simulationMode?: 'simulated' | 'realtime' | 'historical';
  day?: number;
  intradayHour?: number;
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
  intradayHour
}: any) => {
  if (active && payload && payload.length) {
    const timeLabel = formatTimestampToDate(label, startDate, currentDate, simulationMode, day, intradayHour);
    
    // If a participant is selected, only show that one; otherwise show all
    const filteredPayload = selectedParticipantId 
      ? payload.filter((pld: any) => pld.dataKey === selectedParticipantId)
      : payload;
    
    return (
      <div className="bg-arena-surface p-4 rounded-md border border-arena-border shadow-lg">
        <p className="label text-arena-text-primary font-semibold">{timeLabel}</p>
        <div className="mt-2 space-y-1">
          {filteredPayload.sort((a: any, b: any) => b.value - a.value).map((pld: any) => (
            <div key={pld.dataKey} style={{ color: pld.color }} className="text-sm flex justify-between space-x-4">
              <span>{pld.name}:</span>
              <span className="font-mono font-semibold">${pld.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return null;
};

const EndOfLineLabel = ({ points, data, color, name, isBenchmark }: any) => {
  if (!points || points.length === 0 || !data || data.length === 0) return null;

  const lastPoint = points[points.length - 1];
  const { x, y } = lastPoint;
  const value = data[data.length - 1].totalValue;

  return (
    <g transform={`translate(${x + 8}, ${y - 10})`}>
      <rect
        height="22"
        width={name.length * 8 + 65}
        fill={color}
        rx="4"
        style={{ filter: `drop-shadow(0 1px 1px rgb(0 0 0 / 0.5))` }}
      />
      <text x="5" y="15" fill="#fff" fontSize="12px" fontWeight={isBenchmark ? "normal" : "bold"}>
        {name}
      </text>
      <text x={name.length * 8 + 5} y="15" fill="#fff" fontSize="12px" fontWeight="normal" opacity="0.8">
        ${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}
      </text>
    </g>
  );
};


// Helper function to check if a timestamp is within market hours (9:30 AM - 4:00 PM ET)
// For real-time mode, we assume timestamps are already in the correct timezone context
const isWithinMarketHours = (
  timestamp: number,
  simulationMode?: 'simulated' | 'realtime' | 'historical',
  startDate?: string
): boolean => {
  try {
    let date: Date;
    
    if (simulationMode === 'realtime' && timestamp > 1000000000) {
      // Unix timestamp (seconds) - this should already be in UTC
      // The timestamp represents the actual time the data was collected
      // For delayed data, it's 30 minutes ago, but still within market hours
      date = new Date(timestamp * 1000);
      
      // Convert UTC to ET (simplified: ET is UTC-5 or UTC-4)
      // For market hours check, we need to know the hour in ET
      // Since the backend is already calculating this correctly, 
      // we can check if the UTC hour (when converted to ET) is within market hours
      // Market hours: 9:30 AM - 4:00 PM ET
      // ET offset: UTC-5 (EST) or UTC-4 (EDT)
      
      // Simple approximation: check if hour is between 13:30 and 20:00 UTC (9:30-16:00 ET in EST)
      // Or between 14:30 and 21:00 UTC (9:30-16:00 ET in EDT)
      // For simplicity, we'll check a wider range: 13:00-21:00 UTC covers both cases
      const utcHour = date.getUTCHours();
      const utcMinute = date.getUTCMinutes();
      const utcMinutes = utcHour * 60 + utcMinute;
      
      // EST: 9:30 AM ET = 14:30 UTC, 4:00 PM ET = 21:00 UTC
      // EDT: 9:30 AM ET = 13:30 UTC, 4:00 PM ET = 20:00 UTC
      // Use a conservative range that covers both: 13:00-21:30 UTC
      return utcMinutes >= (13 * 60) && utcMinutes < (21 * 60 + 30);
    } else if (startDate) {
      // For simulated/historical: timestamps are day-based, assume all are valid
      // (they're only generated during market hours anyway)
      return true;
    } else {
      // Can't determine, assume it's valid
      return true;
    }
  } catch {
    // On error, assume valid
    return true;
  }
};

// Helper function to get date from timestamp
const getDateFromTimestamp = (
  timestamp: number,
  startDate?: string,
  simulationMode?: 'simulated' | 'realtime' | 'historical'
): Date | null => {
  try {
    if (simulationMode === 'realtime' && timestamp > 1000000000) {
      return new Date(timestamp * 1000);
    } else if (startDate) {
      const start = new Date(startDate);
      if (simulationMode === 'historical' || simulationMode === 'simulated') {
        const daysToAdd = Math.floor(timestamp);
        const date = new Date(start);
        date.setDate(start.getDate() + daysToAdd);
        const hourDecimal = timestamp - daysToAdd;
        const hours = Math.floor(hourDecimal * 10);
        const minutes = Math.round((hourDecimal * 10 - hours) * 60);
        date.setHours(9 + hours, 30 + minutes, 0, 0);
        return date;
      }
    }
    return null;
  } catch {
    return null;
  }
};

// Helper function to format X-axis: show only hour, or day label at day boundaries
const formatXAxisLabel = (
  timestamp: number,
  index: number,
  allTimestamps: number[],
  startDate?: string,
  currentDate?: string,
  simulationMode?: 'simulated' | 'realtime' | 'historical',
  day?: number,
  intradayHour?: number
): string => {
  // For real-time mode with Unix timestamps, we need to format in ET timezone
  if (simulationMode === 'realtime' && timestamp > 1000000000) {
    const date = new Date(timestamp * 1000);
    
    // Check if this is the first data point of a new day in ET timezone
    let isNewDay = false;
    if (index === 0) {
      isNewDay = true;
    } else if (index > 0) {
      const prevTimestamp = allTimestamps[index - 1];
      if (prevTimestamp && prevTimestamp > 1000000000) {
        const prevDate = new Date(prevTimestamp * 1000);
        // Compare dates in ET timezone
        try {
          const currentDateStr = date.toLocaleDateString('en-US', { 
            timeZone: 'America/New_York',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
          });
          const prevDateStr = prevDate.toLocaleDateString('en-US', { 
            timeZone: 'America/New_York',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
          });
          isNewDay = currentDateStr !== prevDateStr;
        } catch {
          // Fallback: use UTC dates
          const currentDay = date.getUTCDate();
          const currentMonth = date.getUTCMonth();
          const currentYear = date.getUTCFullYear();
          const prevDay = prevDate.getUTCDate();
          const prevMonth = prevDate.getUTCMonth();
          const prevYear = prevDate.getUTCFullYear();
          isNewDay = currentDay !== prevDay || currentMonth !== prevMonth || currentYear !== prevYear;
        }
      }
    }
    
    // Check if this is around market open time (9:30 AM ET)
    let isMarketOpenTime = false;
    try {
      // Get hour and minute in ET timezone using Intl.DateTimeFormat
      const etFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });
      const parts = etFormatter.formatToParts(date);
      const etHour = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
      const etMinute = parseInt(parts.find(p => p.type === 'minute')?.value || '0');
      const etMinutes = etHour * 60 + etMinute;
      // Market open is 9:30 AM ET (570 minutes), check within first hour
      isMarketOpenTime = etMinutes >= (9 * 60 + 30) && etMinutes < (10 * 60 + 30);
    } catch {
      // Fallback: use UTC approximation
      const utcHour = date.getUTCHours();
      const utcMinute = date.getUTCMinutes();
      const utcMinutes = utcHour * 60 + utcMinute;
      isMarketOpenTime = utcMinutes >= (13 * 60) && utcMinutes < (15 * 60);
    }
    
    // Show day label only at the start of a new day at market open
    if (isNewDay && isMarketOpenTime) {
      // Format as "Nov 10" - use ET timezone for date
      try {
        return date.toLocaleDateString('en-US', { 
          month: 'short', 
          day: 'numeric',
          timeZone: 'America/New_York' // Use ET timezone
        });
      } catch {
        // Fallback if timezone is not supported
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      }
    }
    
    // Otherwise show only the hour in ET timezone
    try {
      return date.toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit', 
        hour12: true,
        timeZone: 'America/New_York' // Explicitly use ET timezone
      });
    } catch {
      // Fallback if timezone is not supported
      return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    }
  }
  
  // For simulated/historical mode
  const date = getDateFromTimestamp(timestamp, startDate, simulationMode);
  if (!date) {
    // Fallback to simple format
    const dayNum = Math.floor(timestamp);
    const hourDecimal = timestamp - dayNum;
    const hours = Math.floor(hourDecimal * 10);
    const minutes = Math.round((hourDecimal * 10 - hours) * 60);
    return `${hours}:${minutes.toString().padStart(2, '0')}`;
  }
  
  // Check if this is the first data point of a new day
  const currentDay = date.getDate();
  const currentMonth = date.getMonth();
  const currentYear = date.getFullYear();
  const isNewDay = index === 0 || (() => {
    const prevDate = getDateFromTimestamp(allTimestamps[index - 1], startDate, simulationMode);
    if (!prevDate) return false;
    return prevDate.getDate() !== currentDay || prevDate.getMonth() !== currentMonth || prevDate.getFullYear() !== currentYear;
  })();
  
  // Check if this is the first data point of the day (market open - 9:30 AM)
  const hour = date.getHours();
  const minute = date.getMinutes();
  const isMarketOpen = hour === 9 && minute === 30;
  
  // Show day label only at the start of a new day at market open
  if (isNewDay && isMarketOpen) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  
  // Otherwise show only the hour
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
};

export const MainPerformanceChart: React.FC<MainPerformanceChartProps> = ({ 
  participants,
  startDate,
  currentDate,
  simulationMode,
  day,
  intradayHour
}) => {
  const [selectedParticipantId, setSelectedParticipantId] = useState<string | null>(null);
  const [hoveredParticipantId, setHoveredParticipantId] = useState<string | null>(null);
  
  const { chartData, yAxisDomain, dayBoundaries } = useMemo(() => {
    if (!participants.length || participants[0].performanceHistory.length === 0) {
      return { chartData: [], yAxisDomain: ['auto', 'auto'], dayBoundaries: [] };
    }
    
    // Filter participants based on selection
    const visibleParticipants = selectedParticipantId 
      ? participants.filter(p => p.id === selectedParticipantId)
      : participants;
    
    // Collect all unique timestamps (including intraday)
    const allTimestamps = new Set<number>();
    visibleParticipants.forEach(p => {
      p.performanceHistory.forEach(metric => {
        allTimestamps.add(metric.timestamp);
      });
    });
    
    const sortedTimestamps = Array.from(allTimestamps).sort((a, b) => a - b);
    const data = [];
    const boundaries: number[] = [];
    let minValue = Infinity;
    let maxValue = -Infinity;
    let lastDayKey: string | null = null; // Store "YYYY-MM-DD" for day comparison

    sortedTimestamps.forEach((timestamp, index) => {
      // Filter out data points when market is closed (only for real-time mode)
      if (simulationMode === 'realtime') {
        if (!isWithinMarketHours(timestamp, simulationMode, startDate)) {
          return; // Skip this data point
        }
      }
      
      // Check for day boundaries
      let currentDayKey: string | null = null;
      if (simulationMode === 'realtime' && timestamp > 1000000000) {
        // Real-time: use Unix timestamp to get date in ET timezone
        const date = new Date(timestamp * 1000);
        
        // Get date string in ET timezone for day comparison
        // Use Intl.DateTimeFormat to get ET date components
        try {
          const etDateStr = date.toLocaleDateString('en-US', { 
            timeZone: 'America/New_York',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
          });
          // Format: "MM/DD/YYYY"
          currentDayKey = etDateStr;
        } catch {
          // Fallback: use UTC date if timezone is not supported
          currentDayKey = `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}`;
        }
        
        // Check if this is a new day and market open time (9:30 AM ET)
        if (lastDayKey !== null && currentDayKey !== lastDayKey) {
          // This is the first data point of a new day
          // Check if it's around market open (within first hour of market)
          // Get hour in ET timezone
          try {
            const etHour = parseInt(date.toLocaleTimeString('en-US', { 
              timeZone: 'America/New_York',
              hour: '2-digit',
              hour12: false
            }).split(':')[0]);
            const etMinute = parseInt(date.toLocaleTimeString('en-US', { 
              timeZone: 'America/New_York',
              minute: '2-digit'
            }).split(':')[1]);
            const etMinutes = etHour * 60 + etMinute;
            // Market open is 9:30 AM ET (570 minutes)
            if (etMinutes >= (9 * 60 + 30) && etMinutes < (10 * 60 + 30)) {
              boundaries.push(timestamp);
            }
          } catch {
            // Fallback: use UTC approximation
            const utcHour = date.getUTCHours();
            const utcMinute = date.getUTCMinutes();
            const utcMinutes = utcHour * 60 + utcMinute;
            if (utcMinutes >= (13 * 60) && utcMinutes < (15 * 60)) {
              boundaries.push(timestamp);
            }
          }
        }
      } else if (simulationMode === 'historical' || simulationMode === 'simulated') {
        // For simulated/historical: check day boundaries based on day number
        const dayNum = Math.floor(timestamp);
        if (lastDayKey !== null && dayNum.toString() !== lastDayKey && index > 0) {
          // Check if this is market open (hour 0)
          const hourDecimal = timestamp - dayNum;
          const hours = Math.floor(hourDecimal * 10);
          if (hours === 0) {
            boundaries.push(timestamp);
          }
        }
        currentDayKey = dayNum.toString();
      }
      
      lastDayKey = currentDayKey;
      
      const dayData: { [key: string]: number | string } = { timestamp };
      visibleParticipants.forEach(p => {
        // Find the metric with this exact timestamp (or closest)
        // For real-time mode (Unix timestamps > 1000000000), use larger tolerance (60 seconds)
        // For simulated/historical (small timestamps), use smaller tolerance (0.01)
        const tolerance = timestamp > 1000000000 ? 60 : 0.01;
        const metric = p.performanceHistory.find(m => Math.abs(m.timestamp - timestamp) < tolerance) ||
                      p.performanceHistory.find(m => {
                        // Find the closest metric that's <= this timestamp
                        const laterMetrics = p.performanceHistory.filter(m2 => m2.timestamp > m.timestamp && m2.timestamp <= timestamp);
                        return m.timestamp <= timestamp && laterMetrics.length === 0;
                      }) ||
                      // Fallback: find the closest metric overall
                      p.performanceHistory.reduce((closest, m) => {
                        if (!closest) return m;
                        return Math.abs(m.timestamp - timestamp) < Math.abs(closest.timestamp - timestamp) ? m : closest;
                      }, undefined as typeof p.performanceHistory[0] | undefined);
        if (metric) {
          const value = metric.totalValue;
          dayData[p.id] = value;
          minValue = Math.min(minValue, value);
          maxValue = Math.max(maxValue, value);
        }
      });
      // Also include initial capital if no participant is selected
      if (!selectedParticipantId) {
        dayData['initial-capital'] = INITIAL_CASH;
        minValue = Math.min(minValue, INITIAL_CASH);
        maxValue = Math.max(maxValue, INITIAL_CASH);
      }
      data.push(dayData);
    });
    
    // Calculate domain with tighter padding to fit curves better
    const range = maxValue - minValue;
    const padding = Math.max(50, range * 0.05); // 5% padding or minimum $50 for very small ranges
    const domain: [number, number] = [
      Math.max(0, minValue - padding),
      maxValue + padding
    ];
    
    return { chartData: data, yAxisDomain: domain, dayBoundaries: boundaries };
  }, [participants, selectedParticipantId, simulationMode, startDate]);

  if (chartData.length === 0) {
    return <div className="flex items-center justify-center h-full text-arena-text-secondary">Awaiting simulation data...</div>;
  }

  return (
    <div className="relative w-full h-full">
      {selectedParticipantId && (
        <div className="absolute top-2 right-2 z-10 bg-arena-surface px-3 py-1 rounded-md border border-arena-border text-xs text-arena-text-secondary">
          Showing: {participants.find(p => p.id === selectedParticipantId)?.name || 'Selected'}
          <span className="ml-2 text-arena-text-tertiary">(Click chart to show all)</span>
        </div>
      )}
      {!selectedParticipantId && (
        <div className="absolute top-2 right-2 z-10 bg-arena-surface px-3 py-1 rounded-md border border-arena-border text-xs text-arena-text-secondary">
          Hover to highlight • Click to focus
        </div>
      )}
    <ResponsiveContainer width="100%" height="100%" minHeight={200} minWidth={0} aspect={undefined}>
      <LineChart
        data={chartData}
        margin={{ top: 15, right: 170, left: 10, bottom: 5 }}
        onClick={(e) => {
          // If clicking on chart background (not a line), deselect
          if (selectedParticipantId && !e?.activePayload?.length) {
            setSelectedParticipantId(null);
          }
        }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
        {/* Day boundary reference lines (dotted vertical lines) */}
        {dayBoundaries.map((boundary, idx) => (
          <ReferenceLine 
            key={`day-boundary-${idx}`}
            x={boundary} 
            stroke="#737373" 
            strokeDasharray="2 2" 
            strokeWidth={1}
            opacity={0.5}
          />
        ))}
        <XAxis 
          dataKey="timestamp" 
          stroke="#A3A3A3" 
          tick={{ fill: '#A3A3A3', fontSize: 12 }}
          tickFormatter={(value: number, index: number) => formatXAxisLabel(value, index, chartData.map(d => d.timestamp as number), startDate, currentDate, simulationMode, day, intradayHour)}
        />
        <YAxis
          stroke="#A3A3A3"
          tick={{ fill: '#A3A3A3', fontSize: 12 }}
          tickFormatter={(value: number) => `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          domain={yAxisDomain}
          width={80}
        />
        <Tooltip content={
          <CustomTooltip 
            selectedParticipantId={selectedParticipantId || hoveredParticipantId}
            startDate={startDate}
            currentDate={currentDate}
            simulationMode={simulationMode}
            day={day}
            intradayHour={intradayHour}
          />
        } />
        
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

        {participants
          .filter(p => !selectedParticipantId || selectedParticipantId === p.id)
          .map(p => {
            const isHovered = hoveredParticipantId === p.id;
            const isSelected = selectedParticipantId === p.id;
            const opacity = selectedParticipantId && !isSelected ? 0 : (hoveredParticipantId && !isHovered ? 0.2 : 1);
            const strokeWidth = isHovered || isSelected 
              ? ((p as Benchmark).name === "AI Managers Index" ? 4 : 3)
              : ((p as Benchmark).name === "AI Managers Index" ? 3 : 2);
            
            return (
              <Line
                key={p.id}
                type="linear"
                dataKey={p.id}
                stroke={p.color}
                strokeWidth={strokeWidth}
                strokeDasharray={(p as Benchmark).name === "S&P 500" ? "3 3" : "0"}
                dot={false}
                activeDot={{ r: 6, strokeWidth: 2, stroke: p.color, fill: p.color, cursor: 'pointer' }}
                isAnimationActive={false}
                connectNulls={false}
                name={p.name}
                opacity={opacity}
                style={{ cursor: 'pointer', transition: 'opacity 0.2s, stroke-width 0.2s' }}
                onMouseEnter={() => setHoveredParticipantId(p.id)}
                onMouseLeave={() => setHoveredParticipantId(null)}
                onClick={(e) => {
                  e?.stopPropagation?.(); // Prevent chart background click
                  if (selectedParticipantId === p.id) {
                    setSelectedParticipantId(null); // Click again to deselect
                  } else {
                    setSelectedParticipantId(p.id); // Click to select
                  }
                }}
                label={<EndOfLineLabel data={p.performanceHistory} color={p.color} name={p.name} isBenchmark={(p as any).name.includes('Index') || (p as any).name.includes('S&P')} />}
              />
            );
          })}
      </LineChart>
    </ResponsiveContainer>
    </div>
  );
};