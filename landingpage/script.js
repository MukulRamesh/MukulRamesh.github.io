function showSection(sectionId) {
    const sections = document.querySelectorAll('section');
    const currentActive = document.querySelector('section.active');
    const nextActive = document.getElementById(sectionId);

    if (currentActive && currentActive !== nextActive) {
        currentActive.classList.remove('active');
        currentActive.classList.add('fading-out');
        // Remove fading-out after transition
        currentActive.addEventListener('transitionend', function handler(e) {
            if (e.propertyName === 'opacity') {
                currentActive.classList.remove('fading-out');
                currentActive.removeEventListener('transitionend', handler);
            }
        });
    }
    // Activate the new section
    nextActive.classList.add('active');
}

// Section scroll and indicator logic

document.addEventListener('DOMContentLoaded', function () {
    const sections = Array.from(document.querySelectorAll('section'));
    const sectionNames = sections.map(sec => sec.querySelector('h2').textContent);
    const indicator = document.getElementById('section-indicator');
    let currentIndicators = [];
    let hoveredSectionIndex = null;

    // Custom scrollbar elements
    const scrollbarThumb = document.querySelector('.scrollbar-thumb');
    const scrollbarTrack = document.querySelector('.scrollbar-track');
    let isDragging = false;
    let startY = 0;
    let startScrollTop = 0;

    // Calculate total scroll height
    function getTotalScrollHeight() {
        return document.documentElement.scrollHeight - window.innerHeight;
    }

    // Update scrollbar thumb position
    function updateScrollbarThumb() {
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        const totalHeight = getTotalScrollHeight();
        const trackHeight = scrollbarTrack.offsetHeight;
        const thumbHeight = Math.max(30, (window.innerHeight / document.documentElement.scrollHeight) * trackHeight);

        const maxThumbTop = trackHeight - thumbHeight;
        const thumbTop = (scrollTop / totalHeight) * maxThumbTop;

        scrollbarThumb.style.height = thumbHeight + 'px';
        scrollbarThumb.style.top = thumbTop + 'px';
    }

    // Create section markers on scrollbar
    function createScrollbarMarkers() {
        // Clear existing markers
        const existingMarkers = scrollbarTrack.querySelectorAll('.scrollbar-section-marker');
        existingMarkers.forEach(marker => marker.remove());

        sections.forEach((section, index) => {
            const marker = document.createElement('div');
            marker.className = 'scrollbar-section-marker';
            marker.dataset.sectionIndex = index;

            // Position marker based on section position
            const sectionTop = section.offsetTop;
            const totalHeight = document.documentElement.scrollHeight;
            const trackHeight = scrollbarTrack.offsetHeight;
            const markerTop = (sectionTop / totalHeight) * trackHeight;

            marker.style.top = markerTop + 'px';

            // Click handler to scroll to section
            marker.addEventListener('click', (e) => {
                e.stopPropagation();
                section.scrollIntoView({ behavior: 'smooth' });
            });

            scrollbarTrack.appendChild(marker);
        });
    }

    // Update section markers
    function updateScrollbarMarkers() {
        const markers = scrollbarTrack.querySelectorAll('.scrollbar-section-marker');
        const currentSectionIndex = (hoveredSectionIndex !== null) ? hoveredSectionIndex : getCurrentSectionIndex();

        markers.forEach((marker, index) => {
            if (index === currentSectionIndex) {
                marker.classList.add('active');
            } else {
                marker.classList.remove('active');
            }
        });
    }

    // Mouse event handlers for scrollbar thumb
    function initScrollbarDrag() {
        scrollbarThumb.addEventListener('mousedown', (e) => {
            isDragging = true;
            startY = e.clientY;
            startScrollTop = window.pageYOffset || document.documentElement.scrollTop;
            scrollbarThumb.classList.add('dragging');
            document.body.style.userSelect = 'none';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;

            const deltaY = e.clientY - startY;
            const trackHeight = scrollbarTrack.offsetHeight;
            const thumbHeight = scrollbarThumb.offsetHeight;
            const maxThumbTop = trackHeight - thumbHeight;
            const totalHeight = getTotalScrollHeight();

            const newThumbTop = Math.max(0, Math.min(maxThumbTop,
                (startScrollTop / totalHeight) * maxThumbTop + deltaY));

            const newScrollTop = (newThumbTop / maxThumbTop) * totalHeight;

            window.scrollTo(0, newScrollTop);
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                scrollbarThumb.classList.remove('dragging');
                document.body.style.userSelect = '';
            }
        });
    }

    // Click on scrollbar track to jump to position
    function initScrollbarTrackClick() {
        scrollbarTrack.addEventListener('click', (e) => {
            if (e.target === scrollbarTrack) {
                const rect = scrollbarTrack.getBoundingClientRect();
                const clickY = e.clientY - rect.top;
                const trackHeight = rect.height;
                const totalHeight = getTotalScrollHeight();

                const newScrollTop = (clickY / trackHeight) * totalHeight;
                window.scrollTo(0, newScrollTop);
            }
        });
    }

    function getCurrentSectionIndex() {
        const scrollY = window.scrollY;
        let idx = 0;
        for (let i = 0; i < sections.length; i++) {
            const rect = sections[i].getBoundingClientRect();
            const top = rect.top + window.scrollY;
            if (scrollY >= top - window.innerHeight / 2) {
                idx = i;
            }
        }
        return idx;
    }

    function getSectionProximity(idx, i) {
        // 0: current, 1: adjacent, 2+: farther
        return Math.abs(idx - i);
    }

    function getDynamicSizeClass(proximity, progress) {
        // progress: 0 (centered on section), up to 1 (fully in next/prev)
        // Use 3 for current, 2 for near, 1 for far
        if (proximity === 0) return 'indicator-size-3';
        if (proximity === 1) return 'indicator-size-2';
        return 'indicator-size-1';
    }

    function createIndicator(sectionName, index) {
        const item = document.createElement('div');
        item.className = 'section-indicator-item';
        item.textContent = sectionName;
        item.onclick = () => sections[index].scrollIntoView({behavior: 'smooth'});

        // Add fade-in effect after a small delay
        setTimeout(() => {
            item.classList.add('fade-in');
        }, index * 50);

        return item;
    }

    function updateIndicator() {
        const idx = (hoveredSectionIndex !== null) ? hoveredSectionIndex : getCurrentSectionIndex();

        // Update existing indicators or create new ones
        sections.forEach((sec, i) => {
            let item = currentIndicators[i];

            // Create new indicator if it doesn't exist
            if (!item) {
                item = createIndicator(sectionNames[i], i);
                indicator.appendChild(item);
                currentIndicators[i] = item;
            }

            // Update styling based on hover-preferred current section
            let bgColor, textColor, opacity;
            if (hoveredSectionIndex === null) {
                // Neutral when not hovering over any section
                bgColor = 'rgba(200,200,200,0.03)';
                textColor = 'rgba(100,100,100,0.5)';
                opacity = 0.7;
                item.classList.remove('current');
                item.classList.add('not-selected');
            } else if (i === idx) {
                // Hovered section - highlighted
                bgColor = 'rgba(0, 123, 255, 0.08)';
                textColor = 'rgba(0, 123, 255, 0.9)';
                opacity = 1;
                item.classList.add('current');
                item.classList.remove('not-selected');
            } else {
                // Other sections - neutral
                bgColor = 'rgba(200,200,200,0.03)';
                textColor = 'rgba(100,100,100,0.5)';
                opacity = 0.7;
                item.classList.remove('current');
                item.classList.add('not-selected');
            }

            item.style.background = bgColor;
            item.style.color = textColor;
            item.style.opacity = opacity;
        });

        // Remove excess indicators if sections were removed
        while (currentIndicators.length > sections.length) {
            const lastItem = currentIndicators.pop();
            if (lastItem && lastItem.parentNode) {
                lastItem.classList.add('fade-out');
                setTimeout(() => {
                    if (lastItem.parentNode) {
                        lastItem.parentNode.removeChild(lastItem);
                    }
                }, 400);
            }
        }

        // Highlight only the hovered section (if any)
        sections.forEach((sec, i) => {
            if (hoveredSectionIndex !== null && i === idx) {
                sec.classList.add('active');
            } else {
                sec.classList.remove('active');
            }
        });

        // Update scrollbar elements
        updateScrollbarThumb();
        updateScrollbarMarkers();
    }

    // Initialize scrollbar functionality
    function initScrollbar() {
        createScrollbarMarkers();
        initScrollbarDrag();
        initScrollbarTrackClick();
        updateScrollbarThumb();
    }

    // Hover-based highlighting
    sections.forEach((sec, i) => {
        sec.addEventListener('mouseenter', () => {
            hoveredSectionIndex = i;
            updateIndicator();
        });
        sec.addEventListener('mouseleave', () => {
            hoveredSectionIndex = null;
            updateIndicator();
        });
    });

    // Keep resize behavior
    window.addEventListener('resize', () => {
        updateIndicator();
        createScrollbarMarkers();
        updateScrollbarThumb();
    });

    // Initialize everything
    updateIndicator();
    initScrollbar();
});
