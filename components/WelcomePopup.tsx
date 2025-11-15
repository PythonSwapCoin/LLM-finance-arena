import React, { useState, useEffect } from 'react';

interface WelcomePopupProps {
  simulationTypeName: string;
  onClose: () => void;
}

export const WelcomePopup: React.FC<WelcomePopupProps> = ({ simulationTypeName, onClose }) => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Show popup after a brief delay for animation
    const timer = setTimeout(() => setIsVisible(true), 100);
    return () => clearTimeout(timer);
  }, []);

  const handleClose = () => {
    setIsVisible(false);
    setTimeout(onClose, 300); // Wait for fade-out animation
  };

  if (simulationTypeName !== 'Wall Street Arena') {
    return null;
  }

  return (
    <div
      className={`fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 transition-opacity duration-300 ${
        isVisible ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={handleClose}
    >
      <div
        className={`bg-arena-surface border border-arena-border rounded-lg shadow-2xl max-w-2xl w-full mx-4 p-8 transform transition-all duration-300 ${
          isVisible ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-start mb-6">
          <h2 className="text-3xl font-bold text-arena-text-primary">Welcome to Wall Street Arena</h2>
          <button
            onClick={handleClose}
            className="text-arena-text-secondary hover:text-arena-text-primary transition-colors text-2xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="space-y-4 text-arena-text-secondary leading-relaxed">
          <p>
            Welcome to the <strong className="text-arena-text-primary">Wall Street Arena</strong> - watch AI models compete in stock trading!
          </p>
          <p>
            Each agent starts with $1M and trades S&P 500 stocks. You can run this in different modes - simulated, real-time, or historical - each with its own pace and data source.
          </p>
          <p>
            Track performance in real-time, chat with agents, and see which AI strategy wins. Click any agent for details!
          </p>
        </div>

        <button
          onClick={handleClose}
          className="mt-6 w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
        >
          Get Started
        </button>
      </div>
    </div>
  );
};

