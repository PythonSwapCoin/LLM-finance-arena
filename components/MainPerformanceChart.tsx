import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import type { Agent, Benchmark } from '../types';
import { INITIAL_CASH } from '../constants';
import { formatTimestampToDate } from '../utils/timeFormatting';
import { getAgentDisplayName } from '../utils/modelNameFormatter';

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
    
    return (
      <div className="bg-arena-surface p-4 rounded-md border border-arena-border shadow-lg">
        <p className="label text-arena-text-primary font-semibold">{timeLabel}</p>
        <div className="mt-2 space-y-1">
          {filteredPayload.sort((a: any, b: any) => b.value - a.value).map((pld: any, idx: number) => {
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


// Helper function to check if a timestamp is within market hours (9:30 AM - 4:00 PM ET)
// For real-time mode, we assume timestamps are already in the correct timezone context
const isWithinMarketHours = (
  timestamp: number,
  simulationMode?: 'simulated' | 'realtime' | 'historical' | 'hybrid',
  startDate?: string
): boolean => {
  try {
    let date: Date;
    
    if ((simulationMode === 'realtime' || simulationMode === 'hybrid') && timestamp > 1000000000) {
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

// Helper function to check if a date is a weekend (Saturday = 6, Sunday = 0)
const isWeekend = (date: Date, timeZone?: string): boolean => {
  try {
    if (timeZone) {
      // Get day of week in the specified timezone by formatting and parsing
      // Use a formatter to get the weekday name, then check if it's Saturday or Sunday
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        weekday: 'long'
      });
      const weekday = formatter.format(date).toLowerCase();
      return weekday === 'saturday' || weekday === 'sunday';
    } else {
      // Use UTC day of week (0 = Sunday, 6 = Saturday)
      const dayOfWeek = date.getUTCDay();
      return dayOfWeek === 0 || dayOfWeek === 6;
    }
  } catch {
    // Fallback: use UTC
    const dayOfWeek = date.getUTCDay();
    return dayOfWeek === 0 || dayOfWeek === 6;
  }
};

// Helper function to get the next trading day (skip weekends)
const getNextTradingDay = (date: Date, timeZone?: string): Date => {
  const nextDay = new Date(date);
  let daysToAdd = 1;
  
  // Keep adding days until we find a weekday
  while (true) {
    nextDay.setTime(date.getTime() + (daysToAdd * 24 * 60 * 60 * 1000));
    if (!isWeekend(nextDay, timeZone)) {
      break;
    }
    daysToAdd++;
  }
  
  return nextDay;
};

// Helper function to get date from timestamp
const getDateFromTimestamp = (
  timestamp: number,
  startDate?: string,
  simulationMode?: 'simulated' | 'realtime' | 'historical' | 'hybrid'
): Date | null => {
  try {
    // Handle realtime and hybrid mode (after transition) with Unix timestamps
    if ((simulationMode === 'realtime' || simulationMode === 'hybrid') && timestamp > 1000000000) {
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
  simulationMode?: 'simulated' | 'realtime' | 'historical' | 'hybrid',
  day?: number,
  intradayHour?: number,
  timePeriod?: TimePeriod
): string => {
  // Determine time span of the data
  const timeSpan = allTimestamps.length > 0 
    ? allTimestamps[allTimestamps.length - 1] - allTimestamps[0]
    : 0;
  
  // For 'all' period, check if we should show days (if > 1 week) or hours
  const shouldShowDays = timePeriod === '1w' || timePeriod === 'all' || 
    (timePeriod === undefined && timeSpan > 7 * 24 * 60 * 60); // > 1 week in seconds
  
  // For 24h period, always show hours
  const showHoursOnly = timePeriod === '24h' || (!shouldShowDays && timeSpan <= 24 * 60 * 60);
  // For real-time mode with Unix timestamps, we need to format in ET timezone
  // Also handle hybrid mode after transition (when timestamps become Unix timestamps)
  const isRealtimeTimestamp = timestamp > 1000000000;
  if ((simulationMode === 'realtime' || simulationMode === 'hybrid') && isRealtimeTimestamp) {
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
    
    // For 24h period, show hours but also show date at beginning of each day
    if (showHoursOnly) {
      // Check if this is the first data point of a new day
      let isNewDay = false;
      if (index === 0) {
        isNewDay = true;
      } else if (index > 0) {
        const prevTimestamp = allTimestamps[index - 1];
        if (prevTimestamp && prevTimestamp > 1000000000) {
          const prevDate = new Date(prevTimestamp * 1000);
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
        const utcHour = date.getUTCHours();
        const utcMinute = date.getUTCMinutes();
        const utcMinutes = utcHour * 60 + utcMinute;
        isMarketOpenTime = utcMinutes >= (13 * 60) && utcMinutes < (15 * 60);
      }
      
      // Show date label at the beginning of each day (new day + market open time)
      if (isNewDay && isMarketOpenTime) {
        try {
          // If it's a weekend, show the next trading day's date instead
          let displayDate = date;
          if (isWeekend(date, 'America/New_York')) {
            displayDate = getNextTradingDay(date, 'America/New_York');
          }
          
          const dateStr = displayDate.toLocaleDateString('en-US', { 
            month: 'short', 
            day: 'numeric',
            timeZone: 'America/New_York'
          });
          const timeStr = date.toLocaleTimeString('en-US', { 
            hour: '2-digit', 
            minute: '2-digit', 
            hour12: false,
            timeZone: 'America/New_York'
          });
          return `${dateStr} ${timeStr}`;
        } catch {
          // Fallback: check weekend using UTC
          let displayDate = date;
          if (isWeekend(date)) {
            displayDate = getNextTradingDay(date);
          }
          
          const dateStr = displayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
          return `${dateStr} ${timeStr}`;
        }
      }
      
      // Otherwise show only the time
      try {
        return date.toLocaleTimeString('en-US', { 
          hour: '2-digit', 
          minute: '2-digit', 
          hour12: false,
          timeZone: 'America/New_York'
        });
      } catch {
        return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
      }
    }
    
    // For longer periods, show days with smart spacing (max 2 labels per day)
    // Only show day label at market open or market close
    if (shouldShowDays) {
      // Check if we should show this label (limit to 2 per day: market open and close)
      const etMinutes = (() => {
        try {
          const etFormatter = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/New_York',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
          });
          const parts = etFormatter.formatToParts(date);
          const etHour = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
          const etMinute = parseInt(parts.find(p => p.type === 'minute')?.value || '0');
          return etHour * 60 + etMinute;
        } catch {
          const utcHour = date.getUTCHours();
          const utcMinute = date.getUTCMinutes();
          return (utcHour + 5) * 60 + utcMinute; // Approximate ET
        }
      })();
      
      // Calculate how many days are in the visible range
      const totalDays = (() => {
        if (allTimestamps.length === 0) return 0;
        const firstTimestamp = allTimestamps[0];
        const lastTimestamp = allTimestamps[allTimestamps.length - 1];
        
        if ((simulationMode === 'realtime' || simulationMode === 'hybrid') && firstTimestamp > 1000000000 && lastTimestamp > 1000000000) {
          const firstDate = new Date(firstTimestamp * 1000);
          const lastDate = new Date(lastTimestamp * 1000);
          const diffTime = Math.abs(lastDate.getTime() - firstDate.getTime());
          return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        } else {
          return Math.floor(lastTimestamp) - Math.floor(firstTimestamp) + 1;
        }
      })();
      
      // For shorter periods (e.g., 9 days), show every day
      // For longer periods, show every few days
      const showEveryNDays = totalDays <= 10 ? 1 : totalDays <= 30 ? 2 : 5;
      
      // Show label at market open (9:30 AM) for new days
      const isMarketOpen = etMinutes >= (9 * 60 + 30) && etMinutes < (9 * 60 + 45);
      
      if (isNewDay && isMarketOpen) {
        // Calculate day number to determine if we should show this label
        const dayNumber = (() => {
          if ((simulationMode === 'realtime' || simulationMode === 'hybrid') && timestamp > 1000000000) {
            // For realtime, calculate day number from start
            if (startDate) {
              const start = new Date(startDate);
              const current = new Date(timestamp * 1000);
              const diffTime = current.getTime() - start.getTime();
              return Math.floor(diffTime / (1000 * 60 * 60 * 24));
            }
            return 0;
          } else {
            return Math.floor(timestamp);
          }
        })();
        
        // Show label if it's a day we want to show, or if it's first/last point
        if (dayNumber % showEveryNDays === 0 || index === 0 || index === allTimestamps.length - 1) {
          try {
            // If it's a weekend, show the next trading day's date instead
            let displayDate = date;
            if (isWeekend(date, 'America/New_York')) {
              displayDate = getNextTradingDay(date, 'America/New_York');
            }
            
            return displayDate.toLocaleDateString('en-US', { 
              month: 'short', 
              day: 'numeric',
              timeZone: 'America/New_York'
            });
          } catch {
            // Fallback: check weekend using UTC
            let displayDate = date;
            if (isWeekend(date)) {
              displayDate = getNextTradingDay(date);
            }
            
            return displayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          }
        }
      }
      
      // For other times, show nothing to reduce clutter
      return '';
    }
    
    // Show day label only at the start of a new day at market open
    if (isNewDay && isMarketOpenTime) {
      // Format as "Nov 10" - use ET timezone for date
      // If it's a weekend, show the next trading day's date instead
      try {
        let displayDate = date;
        if (isWeekend(date, 'America/New_York')) {
          displayDate = getNextTradingDay(date, 'America/New_York');
        }
        
        return displayDate.toLocaleDateString('en-US', { 
          month: 'short', 
          day: 'numeric',
          timeZone: 'America/New_York' // Use ET timezone
        });
      } catch {
        // Fallback: check weekend using UTC
        let displayDate = date;
        if (isWeekend(date)) {
          displayDate = getNextTradingDay(date);
        }
        
        return displayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      }
    }
    
    // Otherwise show only the hour in ET timezone
    try {
      return date.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit', 
        hour12: false,
        timeZone: 'America/New_York' // Explicitly use ET timezone
      });
    } catch {
      // Fallback if timezone is not supported
      return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    }
  }
  
  // For simulated or hybrid mode (before transition), use startDate to calculate actual dates
  if (simulationMode === 'simulated' || simulationMode === 'hybrid') {
    const dayNum = Math.floor(timestamp);
    const hourDecimal = timestamp - dayNum;
    const hours = Math.floor(hourDecimal * 10);
    const minutes = Math.round((hourDecimal * 10 - hours) * 60);
    
    // Check if this is a new day (compare day numbers) - declare outside if blocks so it's accessible everywhere
    const isNewDay = index === 0 || Math.floor(allTimestamps[index - 1]) !== dayNum;
    const isMarketOpen = hours === 0 && minutes === 0; // Market open is 9:30 AM = hour 0, minute 0
    
    // For 24h period, show hours but also show date at beginning of each day
    if (showHoursOnly) {
      // Show date label at the beginning of each day
      if (isNewDay && isMarketOpen) {
        if (startDate) {
          const baseDate = new Date(startDate);
          const simulatedDate = new Date(baseDate);
          simulatedDate.setDate(baseDate.getDate() + dayNum);
          simulatedDate.setHours(9, 30, 0, 0);
          
          const dateStr = simulatedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          const timeStr = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
          return `${dateStr} ${timeStr}`;
        } else {
          const displayDay = dayNum + 1;
          const timeStr = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
          return `Day ${displayDay} ${timeStr}`;
        }
      }
      
      // Otherwise show only the time
      const date = new Date(Date.UTC(2000, 0, 1, 9 + hours, 30 + minutes, 0, 0));
      return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
    }
    
    // For longer periods, show days with smart spacing
    if (shouldShowDays) {
      // Calculate total days in range
      const totalDays = allTimestamps.length > 0 
        ? Math.floor(allTimestamps[allTimestamps.length - 1]) - Math.floor(allTimestamps[0]) + 1
        : 0;
      
      // For shorter periods (e.g., 9 days), show every day
      const showEveryNDays = totalDays <= 10 ? 1 : totalDays <= 30 ? 2 : 5;
      
      if (isNewDay && isMarketOpen) {
        // Show label if it's a day we want to show, or if it's first/last point
        if (dayNum % showEveryNDays === 0 || index === 0 || index === allTimestamps.length - 1) {
          if (startDate) {
            const baseDate = new Date(startDate);
            const simulatedDate = new Date(baseDate);
            simulatedDate.setDate(baseDate.getDate() + dayNum);
            simulatedDate.setHours(9, 30, 0, 0);
            
            const day = simulatedDate.getDate();
            const monthFormatter = new Intl.DateTimeFormat('en-US', { month: 'short' });
            const month = monthFormatter.format(simulatedDate);
            return `${day.toString().padStart(2, '0')}/${month}`;
          } else {
            const displayDay = dayNum + 1;
            return `Day ${displayDay}`;
          }
        }
      }
      
      // Otherwise, return empty to reduce clutter
      return '';
    }
    
    // Show date label at market open of a new day
    if (isNewDay && isMarketOpen) {
      if (startDate) {
        // Calculate the actual date from startDate
        const baseDate = new Date(startDate);
        const simulatedDate = new Date(baseDate);
        simulatedDate.setDate(baseDate.getDate() + dayNum);
        simulatedDate.setHours(9, 30, 0, 0);
        
        // Format as "06/Jan" style
        const day = simulatedDate.getDate();
        const monthFormatter = new Intl.DateTimeFormat('en-US', { month: 'short' });
        const month = monthFormatter.format(simulatedDate);
        return `${day.toString().padStart(2, '0')}/${month}`;
      } else {
        // Fallback: show "Day X" if no startDate
        const displayDay = dayNum + 1;
        return `Day ${displayDay}`;
      }
    }
    
    // Otherwise show just the time
    const date = new Date(Date.UTC(2000, 0, 1, 9 + hours, 30 + minutes, 0, 0));
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  
  // For historical/realtime mode, use date-based formatting
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
  const isMarketClose = hour === 16 && minute === 0;
  
  // For 24h period, show hours but also show date at beginning of each day
  if (showHoursOnly) {
    // Show date label at the beginning of each day
    if (isNewDay && isMarketOpen) {
      // For historical mode, use startDate to show the actual historical date
      if (simulationMode === 'historical' && startDate) {
        const start = new Date(startDate);
        const daysToAdd = Math.floor(timestamp);
        const histDate = new Date(start);
        histDate.setDate(start.getDate() + daysToAdd);
        const dateStr = histDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
        return `${dateStr} ${timeStr}`;
      }
      const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
      return `${dateStr} ${timeStr}`;
    }
    
    // Otherwise show only the time
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  
  // For longer periods, show days with smart spacing
  if (shouldShowDays) {
    // Calculate total days in range
    const totalDays = allTimestamps.length > 0 
      ? Math.floor(allTimestamps[allTimestamps.length - 1]) - Math.floor(allTimestamps[0]) + 1
      : 0;
    
    // For shorter periods (e.g., 9 days), show every day
    const showEveryNDays = totalDays <= 10 ? 1 : totalDays <= 30 ? 2 : 5;
    
    if (isNewDay && isMarketOpen) {
      const dayNumber = Math.floor(timestamp);
      // Show label if it's a day we want to show, or if it's first/last point
      if (dayNumber % showEveryNDays === 0 || index === 0 || index === allTimestamps.length - 1) {
        if (simulationMode === 'historical' && startDate) {
          const start = new Date(startDate);
          const daysToAdd = Math.floor(timestamp);
          const histDate = new Date(start);
          histDate.setDate(start.getDate() + daysToAdd);
          return histDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        }
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      }
    }
    
    // Otherwise, return empty to reduce clutter
    return '';
  }
  
  // Show day label only at the start of a new day at market open
  if (isNewDay && isMarketOpen) {
    // For historical mode, use startDate to show the actual historical date
    if (simulationMode === 'historical' && startDate) {
      const start = new Date(startDate);
      const daysToAdd = Math.floor(timestamp);
      const histDate = new Date(start);
      histDate.setDate(start.getDate() + daysToAdd);
      return histDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  // Otherwise show only the hour
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
};

type TimePeriod = '24h' | '1w' | 'all';

// Helper function to determine which ticks should be shown based on available space
const getVisibleTickIndices = (
  chartData: any[],
  containerWidth: number,
  startDate?: string,
  currentDate?: string,
  simulationMode?: 'simulated' | 'realtime' | 'historical' | 'hybrid',
  day?: number,
  intradayHour?: number,
  timePeriod?: TimePeriod
): Set<number> => {
  if (chartData.length === 0 || containerWidth === 0) {
    return new Set();
  }

  const visibleIndices = new Set<number>();
  const estimatedLabelWidth = 60; // Estimated width of a label in pixels (e.g., "14:30" or "Nov 10")
  
  // Get all timestamps
  const timestamps = chartData.map(d => d.timestamp as number);
  
  // First, determine which indices have labels
  const indicesWithLabels: number[] = [];
  chartData.forEach((d, idx) => {
    const label = formatXAxisLabel(
      d.timestamp as number,
      idx,
      timestamps,
      startDate,
      currentDate,
      simulationMode,
      day,
      intradayHour,
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

  const { chartData, yAxisDomain, dayBoundaries } = useMemo(() => {
    if (!participants || !participants.length || !participants[0] || !participants[0].performanceHistory || participants[0].performanceHistory.length === 0) {
      return { chartData: [], yAxisDomain: ['auto', 'auto'], dayBoundaries: [] };
    }
    
    // Filter participants based on selection
    const visibleParticipants = selectedParticipantId 
      ? participants.filter(p => p.id === selectedParticipantId)
      : participants;
    
    // Collect all unique timestamps (including intraday)
    const allTimestamps = new Set<number>();
    visibleParticipants.forEach(p => {
      if (p.performanceHistory && Array.isArray(p.performanceHistory)) {
        p.performanceHistory.forEach(metric => {
          allTimestamps.add(metric.timestamp);
        });
      }
    });
    
    const sortedTimestamps = Array.from(allTimestamps).sort((a, b) => a - b);
    
    // Filter timestamps based on selected time period
    let timeFilteredTimestamps = sortedTimestamps;
    if (sortedTimestamps.length > 0) {
      const latestTimestamp = sortedTimestamps[sortedTimestamps.length - 1];
      
      if (timePeriod === '24h') {
        // Filter to last 24 hours
        const cutoffTime = latestTimestamp - (24 * 60 * 60); // 24 hours in seconds for Unix timestamps
        timeFilteredTimestamps = sortedTimestamps.filter(ts => {
          if (ts > 1000000000) {
            // Unix timestamp (seconds)
            return ts >= cutoffTime;
          } else {
            // Day-based timestamp - approximate: 1 day = 1.0
            return ts >= (latestTimestamp - 1.0);
          }
        });
      } else if (timePeriod === '1w') {
        // Filter to last 5 business days (1 week)
        const cutoffTime = latestTimestamp - (5 * 24 * 60 * 60); // 5 days in seconds for Unix timestamps
        timeFilteredTimestamps = sortedTimestamps.filter(ts => {
          if (ts > 1000000000) {
            // Unix timestamp (seconds)
            return ts >= cutoffTime;
          } else {
            // Day-based timestamp - approximate: 5 days = 5.0
            return ts >= (latestTimestamp - 5.0);
          }
        });
      }
      // 'all' period: use all timestamps (no filtering)
    }
    
    const data = [];
    const boundaries: number[] = [];
    let minValue = Infinity;
    let maxValue = -Infinity;
    let lastDayKey: string | null = null; // Store "YYYY-MM-DD" for day comparison

    // For realtime mode: filter out flat periods between market close and next day open
    // This creates gaps in the chart similar to Yahoo Finance
    // Also handle hybrid mode after transition
    let filteredTimestamps = timeFilteredTimestamps;
    const isRealtimeMode = simulationMode === 'realtime' || (simulationMode === 'hybrid' && timeFilteredTimestamps.length > 0 && timeFilteredTimestamps[0] > 1000000000);
    if (isRealtimeMode) {
      filteredTimestamps = [];
      let lastTimestamp: number | null = null;
      
      timeFilteredTimestamps.forEach((timestamp, index) => {
        if (!isWithinMarketHours(timestamp, simulationMode, startDate)) {
          return; // Skip data points outside market hours
        }
        
        // Check if this is a new trading day (gap between days)
        if (lastTimestamp !== null && timestamp > 1000000000) {
          const lastDate = new Date(lastTimestamp * 1000);
          const currentDate = new Date(timestamp * 1000);
          
          // Check if dates are different in ET timezone
          try {
            const lastDateStr = lastDate.toLocaleDateString('en-US', { 
              timeZone: 'America/New_York',
              year: 'numeric',
              month: '2-digit',
              day: '2-digit'
            });
            const currentDateStr = currentDate.toLocaleDateString('en-US', { 
              timeZone: 'America/New_York',
              year: 'numeric',
              month: '2-digit',
              day: '2-digit'
            });
            
            // If different days, we've already skipped the flat period (market closed hours)
            // So we can add this point
            if (lastDateStr !== currentDateStr) {
              filteredTimestamps.push(timestamp);
              lastTimestamp = timestamp;
            } else {
              // Same day, add it
              filteredTimestamps.push(timestamp);
              lastTimestamp = timestamp;
            }
          } catch {
            // Fallback: add all timestamps
            filteredTimestamps.push(timestamp);
            lastTimestamp = timestamp;
          }
        } else {
          // First timestamp or not a Unix timestamp
          filteredTimestamps.push(timestamp);
          lastTimestamp = timestamp;
        }
      });
    }
    
    filteredTimestamps.forEach((timestamp, index) => {
      // Find the original index in sortedTimestamps for boundary detection
      const originalIndex = sortedTimestamps.indexOf(timestamp);

      // Check for day boundaries
      let currentDayKey: string | null = null;
      if ((simulationMode === 'realtime' || simulationMode === 'hybrid') && timestamp > 1000000000) {
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
        // Include first data point (index === 0) as a day boundary
        // Skip weekends - don't show boundaries for Saturday/Sunday
        const isNewDay = lastDayKey === null || currentDayKey !== lastDayKey;
        if (isNewDay) {
          // Skip weekend days - don't show boundaries for them
          if (isWeekend(date, 'America/New_York')) {
            // Don't add boundary for weekend, but still update lastDayKey to track the day
            lastDayKey = currentDayKey;
            // Continue to next iteration - don't process this day further
          } else {
            // This is the first data point of a new day (or the very first data point)
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
                // Check if this is Monday after a weekend (i.e., there was a gap from Friday)
                // by checking if the previous trading day was more than 1 day ago
                if (index > 0) {
                  const prevTimestamp = filteredTimestamps[index - 1];
                  const prevDate = new Date(prevTimestamp * 1000);
                  const daysDiff = (timestamp - prevTimestamp) / (24 * 60 * 60); // difference in days

                  // If there's a gap of more than 1.5 days (indicating a weekend), add two boundaries
                  if (daysDiff > 1.5) {
                    // Add a boundary for "Saturday" (end of Friday) - slightly before Monday
                    // Use a timestamp that's 1 second before the Monday market open
                    boundaries.push(timestamp - 1);
                    // Add a boundary for Monday market open
                    boundaries.push(timestamp);
                  } else {
                    // Normal day transition, just add one boundary
                    boundaries.push(timestamp);
                  }
                } else {
                  // First data point, just add one boundary
                  boundaries.push(timestamp);
                }
              }
            } catch {
              // Fallback: use UTC approximation
              const utcHour = date.getUTCHours();
              const utcMinute = date.getUTCMinutes();
              const utcMinutes = utcHour * 60 + utcMinute;
              if (utcMinutes >= (13 * 60) && utcMinutes < (15 * 60)) {
                // Check for weekend gap
                if (index > 0) {
                  const prevTimestamp = filteredTimestamps[index - 1];
                  const daysDiff = (timestamp - prevTimestamp) / (24 * 60 * 60);

                  if (daysDiff > 1.5) {
                    boundaries.push(timestamp - 1);
                    boundaries.push(timestamp);
                  } else {
                    boundaries.push(timestamp);
                  }
                } else {
                  boundaries.push(timestamp);
                }
              }
            }
          }
        }
      } else if (simulationMode === 'historical' || simulationMode === 'simulated' || simulationMode === 'hybrid') {
        // For simulated/historical/hybrid: check day boundaries based on day number
        // Hybrid mode before transition behaves like simulated mode
        const dayNum = Math.floor(timestamp);
        const isNewDay = lastDayKey === null || dayNum.toString() !== lastDayKey;
        if (isNewDay) {
          // Check if this is market open (hour 0) - include first data point
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
        if (!p.performanceHistory || !Array.isArray(p.performanceHistory) || p.performanceHistory.length === 0) {
          return;
        }
        
        // Find the metric that matches this timestamp exactly or is closest
        // Use a tolerance based on timestamp type (Unix vs day-based)
        const tolerance = timestamp > 1000000000 ? 60 : 0.01; // 60 seconds for Unix, 0.01 days for day-based
        
        // First, try to find an exact or very close match
        let bestMetric: typeof p.performanceHistory[0] | undefined = p.performanceHistory.find(m => {
          return Math.abs(m.timestamp - timestamp) < tolerance;
        });
        
        // If no close match, find the most recent metric that's <= this timestamp
        // This ensures continuity - if a participant doesn't have data at exactly this timestamp,
        // we use their most recent value, preventing gaps in the graph
        if (!bestMetric) {
          const metricsAtOrBefore = p.performanceHistory.filter(m => m.timestamp <= timestamp);
          
          if (metricsAtOrBefore.length > 0) {
            // Use the most recent metric <= timestamp
            bestMetric = metricsAtOrBefore.reduce((latest, m) => {
              return m.timestamp > latest.timestamp ? m : latest;
            });
            
            // Only use this value if it's reasonably close (within 5x tolerance for continuity)
            // This prevents using very old values that would create incorrect plotting
            const maxDistance = tolerance * 5;
            if (Math.abs(bestMetric.timestamp - timestamp) > maxDistance) {
              // Too far away, don't use it - let the line break naturally
              bestMetric = undefined;
            }
          } else {
            // No metric <= timestamp - check if there's a future metric very close
            // This handles cases where timestamps are slightly off
            const futureMetrics = p.performanceHistory.filter(m => m.timestamp > timestamp);
            if (futureMetrics.length > 0) {
              const closestFuture = futureMetrics.reduce((closest, m) => {
                return Math.abs(m.timestamp - timestamp) < Math.abs(closest.timestamp - timestamp) ? m : closest;
              });
              // Only use if it's very close (within 2x tolerance)
              if (Math.abs(closestFuture.timestamp - timestamp) < tolerance * 2) {
                bestMetric = closestFuture;
              }
            }
          }
        }
        
        if (bestMetric) {
          const value = bestMetric.totalValue;
          dayData[p.id] = value;
          minValue = Math.min(minValue, value);
          maxValue = Math.max(maxValue, value);
        }
        // If no bestMetric found, leave it undefined - this will create a gap in the line
        // which is correct behavior when there's no data
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
    // For filtered periods (24h, 1w), center the data in the graph and maximize space
    // For 'all' period, use standard padding
    const range = maxValue - minValue;
    let domain: [number, number];
    
    if (timePeriod === '24h' || timePeriod === '1w') {
      // Center the data: add minimal padding to maximize space utilization
      // Use smaller padding percentage to maximize the visible range
      const paddingPercent = 0.08; // 8% padding on each side for better space utilization
      const padding = Math.max(50, range * paddingPercent); // Minimum $50 padding
      const center = (minValue + maxValue) / 2;
      const totalRange = range + (padding * 2);
      domain = [
        Math.max(0, center - totalRange / 2),
        center + totalRange / 2
      ];
    } else {
      // Standard padding for full view
      const padding = Math.max(50, range * 0.05); // 5% padding or minimum $50
      domain = [
        Math.max(0, minValue - padding),
        maxValue + padding
      ];
    }
    
    return { chartData: data, yAxisDomain: domain, dayBoundaries: boundaries };
  }, [participants, selectedParticipantId, simulationMode, startDate, timePeriod]);

  // Calculate which ticks should be visible based on available space
  const visibleTickIndices = useMemo(() => {
    return getVisibleTickIndices(
      chartData,
      effectiveWidth,
      startDate,
      currentDate,
      simulationMode,
      day,
      intradayHour,
      timePeriod
    );
  }, [chartData, effectiveWidth, startDate, currentDate, simulationMode, day, intradayHour, timePeriod]);

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
        {(() => {
          // For 24h period, show day boundaries at the start of each day
          // For other periods, show where there are visible ticks
          const dayBoundaryTimestamps: number[] = [];
          
          if (timePeriod === '24h') {
            // For 24h period, find all day boundaries (start of each day)
            let lastDayKey: string | null = null;
            chartData.forEach((d, idx) => {
              const timestamp = d.timestamp as number;
              let currentDayKey: string | null = null;

              if ((simulationMode === 'realtime' || simulationMode === 'hybrid') && timestamp > 1000000000) {
                // Real-time: use Unix timestamp to get date in ET timezone
                const date = new Date(timestamp * 1000);
                try {
                  const etDateStr = date.toLocaleDateString('en-US', {
                    timeZone: 'America/New_York',
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit'
                  });
                  currentDayKey = etDateStr;

                  // Check if this is a new day and around market open (9:30 AM ET)
                  // Skip weekends - don't show boundaries for Saturday/Sunday
                  const isNewDay = lastDayKey === null || currentDayKey !== lastDayKey;
                  if (isNewDay) {
                    // Skip weekend days - don't show boundaries for them
                    if (!isWeekend(date, 'America/New_York')) {
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
                        // Market open is 9:30 AM ET (570 minutes), check within first hour
                        if (etMinutes >= (9 * 60 + 30) && etMinutes < (10 * 60 + 30)) {
                          // Check if this is Monday after a weekend
                          if (idx > 0) {
                            const prevTimestamp = chartData[idx - 1].timestamp as number;
                            const daysDiff = (timestamp - prevTimestamp) / (24 * 60 * 60);

                            // If there's a gap of more than 1.5 days (indicating a weekend), add two boundaries
                            if (daysDiff > 1.5) {
                              // Add boundary for "Saturday" (end of Friday)
                              dayBoundaryTimestamps.push(timestamp - 1);
                              // Add boundary for Monday market open
                              dayBoundaryTimestamps.push(timestamp);
                            } else {
                              dayBoundaryTimestamps.push(timestamp);
                            }
                          } else {
                            dayBoundaryTimestamps.push(timestamp);
                          }
                        }
                      } catch {
                        const utcHour = date.getUTCHours();
                        const utcMinute = date.getUTCMinutes();
                        const utcMinutes = utcHour * 60 + utcMinute;
                        if (utcMinutes >= (13 * 60) && utcMinutes < (15 * 60)) {
                          // Check for weekend gap
                          if (idx > 0) {
                            const prevTimestamp = chartData[idx - 1].timestamp as number;
                            const daysDiff = (timestamp - prevTimestamp) / (24 * 60 * 60);

                            if (daysDiff > 1.5) {
                              dayBoundaryTimestamps.push(timestamp - 1);
                              dayBoundaryTimestamps.push(timestamp);
                            } else {
                              dayBoundaryTimestamps.push(timestamp);
                            }
                          } else {
                            dayBoundaryTimestamps.push(timestamp);
                          }
                        }
                      }
                    }
                  }
                } catch {
                  currentDayKey = `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}`;
                }
              } else if (simulationMode === 'historical' || simulationMode === 'simulated' || simulationMode === 'hybrid') {
                // For simulated/historical/hybrid: check day boundaries based on day number
                const dayNum = Math.floor(timestamp);
                const isNewDay = lastDayKey === null || dayNum.toString() !== lastDayKey;
                if (isNewDay) {
                  // Check if this is market open (hour 0)
                  const hourDecimal = timestamp - dayNum;
                  const hours = Math.floor(hourDecimal * 10);
                  if (hours === 0) {
                    dayBoundaryTimestamps.push(timestamp);
                  }
                }
                currentDayKey = dayNum.toString();
              }
              
              lastDayKey = currentDayKey;
            });
          } else {
            // For other periods, only show reference lines where there are visible ticks
            const timestampsWithVisibleTicks = chartData
              .map((d, idx) => {
                // Only include if this index is in the visible set
                if (!visibleTickIndices.has(idx)) return null;
                
                const label = formatXAxisLabel(
                  d.timestamp as number,
                  idx,
                  chartData.map(d => d.timestamp as number),
                  startDate,
                  currentDate,
                  simulationMode,
                  day,
                  intradayHour,
                  timePeriod
                );
                // Check if label contains a date (not just time)
                const isDateLabel = label && (label.includes('/') || label.includes(' ') || label.match(/\d{1,2}\s+\w{3}/));
                return isDateLabel ? d.timestamp : null;
              })
              .filter((ts): ts is number => ts !== null);
            
            dayBoundaryTimestamps.push(...timestampsWithVisibleTicks);
          }
          
          return dayBoundaryTimestamps.map((boundary, idx) => (
            <ReferenceLine 
              key={`day-boundary-${idx}`}
              x={boundary} 
              stroke="#A3A3A3" 
              strokeDasharray="4 4" 
              strokeWidth={1.5}
              opacity={0.7}
            />
          ));
        })()}
        <XAxis 
          dataKey="timestamp" 
          type="number"
          scale="linear"
          stroke="#A3A3A3"
          ticks={visibleTickTimestamps}
          tick={(props: any) => {
            const { x, y, payload } = props;
            
            // Find the index in chartData for this timestamp
            const dataIndex = chartData.findIndex(d => {
              const ts = d.timestamp as number;
              const payloadTs = payload.value;
              // Use appropriate tolerance based on timestamp type
              const tolerance = ts > 1000000000 ? 60 : 0.01;
              return Math.abs(ts - payloadTs) < tolerance;
            });
            
            // Only render if this index is in the visible set
            if (dataIndex === -1 || !visibleTickIndices.has(dataIndex)) return null;
            
            const label = formatXAxisLabel(
              payload.value,
              dataIndex,
              chartData.map(d => d.timestamp as number),
              startDate,
              currentDate,
              simulationMode,
              day,
              intradayHour,
              timePeriod
            );
            
            // Only render tick if there's a label
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
            
            // Check if this timestamp is in our visible ticks array
            const isVisible = visibleTickTimestamps.some(ts => {
              const tolerance = ts > 1000000000 ? 60 : 0.01;
              return Math.abs(ts - timestamp) < tolerance;
            });
            
            if (!isVisible) return null;
            
            const dataIndex = chartData.findIndex(d => {
              const ts = d.timestamp as number;
              const tolerance = ts > 1000000000 ? 60 : 0.01;
              return Math.abs(ts - timestamp) < tolerance;
            });
            
            if (dataIndex === -1 || !visibleTickIndices.has(dataIndex)) return null;
            
            const label = formatXAxisLabel(
              timestamp,
              dataIndex,
              chartData.map(d => d.timestamp as number),
              startDate,
              currentDate,
              simulationMode,
              day,
              intradayHour,
              timePeriod
            );
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