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
    // Add class to body to indicate JavaScript is enabled
    document.body.classList.add('js-enabled');

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
                bgColor = 'rgba(196, 181, 160, 0.05)';
                textColor = 'rgba(139, 115, 85, 0.6)';
                opacity = 0.7;
                item.classList.remove('current');
                item.classList.add('not-selected');
            } else if (i === idx) {
                // Hovered section - highlighted
                bgColor = 'rgba(112, 66, 20, 0.12)';
                textColor = 'rgba(112, 66, 20, 0.95)';
                opacity = 1;
                item.classList.add('current');
                item.classList.remove('not-selected');
            } else {
                // Other sections - neutral
                bgColor = 'rgba(196, 181, 160, 0.05)';
                textColor = 'rgba(139, 115, 85, 0.6)';
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
    // Initialize cards truncation and toggle behaviour
    function initCards() {
        const cards = Array.from(document.querySelectorAll('.cards-grid .card'));
        cards.forEach(card => {
            const desc = card.querySelector('p');
            if (!desc) return;
            const fullText = desc.textContent.trim();
            desc.dataset.full = fullText;

            // Hide text initially (no truncation preview) - only if JS is enabled
            if (document.body.classList.contains('js-enabled')) {
                desc.textContent = '';
                desc.style.display = 'none';
                card.setAttribute('aria-expanded', 'false');
                card.classList.remove('expanded');
                // Add dimmed class to all cards by default
                card.classList.add('dimmed');
            }

            // Add indicator after heading if not present
            const hdr = card.querySelector('h3');
            if (hdr && !card.querySelector('.more-indicator')) {
                const more = document.createElement('span');
                more.className = 'more-indicator';
                more.textContent = 'Read more';
                hdr.appendChild(more);
            }

            // make card keyboard focusable
            if (!card.hasAttribute('tabindex')) card.setAttribute('tabindex', '0');

            // click toggles expanded state
            card.addEventListener('click', (e) => {
                e.preventDefault();
                if (!card.classList.contains('expanded')) {
                    // Collapse all other cards first
                    cards.forEach(otherCard => {
                        if (otherCard !== card && otherCard.classList.contains('expanded')) {
                            // Clear any ongoing typewriter effect
                            if (otherCard.dataset.typeInterval) {
                                clearInterval(otherCard.dataset.typeInterval);
                                delete otherCard.dataset.typeInterval;
                            }

                            otherCard.classList.remove('expanded');
                            const otherD = otherCard.querySelector('p');
                            otherD.textContent = '';
                            otherD.style.display = 'none';
                            otherCard.setAttribute('aria-expanded', 'false');
                            const otherInd = otherCard.querySelector('.more-indicator');
                            if (otherInd) otherInd.textContent = 'Read more';
                        }
                    });

                    // Add dimmed class to all other cards
                    cards.forEach(otherCard => {
                        if (otherCard !== card) {
                            otherCard.classList.add('dimmed');
                        }
                    });

                    // expand with typewriter effect
                    card.classList.remove('dimmed'); // Remove dimmed from the card being expanded
                    card.classList.add('expanded');
                    const d = card.querySelector('p');
                    const fullText = d.dataset.full;

                    // Show the paragraph and clear current text, start typewriter effect (word by word)
                    d.style.display = 'block';
                    d.innerHTML = '';

                    // Split by words but preserve newlines
                    const parts = fullText.split(/(\s+)/); // Split keeping whitespace
                    let partIndex = 0;
                    const typeSpeed = 1; // milliseconds per word (adjust for speed)

                    const typeInterval = setInterval(() => {
                        if (partIndex < parts.length) {
                            const part = parts[partIndex];
                            // Convert newlines to <br> tags for HTML rendering
                            if (part.includes('\n')) {
                                d.innerHTML += part.replace(/\n/g, '<br>');
                            } else {
                                d.innerHTML += part;
                            }
                            partIndex++;
                        } else {
                            clearInterval(typeInterval);
                        }
                    }, typeSpeed);

                    // Store interval ID so we can clear it if user collapses before completion
                    card.dataset.typeInterval = typeInterval;

                    card.setAttribute('aria-expanded', 'true');
                    const ind = card.querySelector('.more-indicator'); if (ind) ind.textContent = 'Show less';

                    // Scroll card into view smoothly, accounting for fixed navbar
                    setTimeout(() => {
                        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }, 50);
                } else {
                    // collapse
                    // Clear any ongoing typewriter effect
                    if (card.dataset.typeInterval) {
                        clearInterval(card.dataset.typeInterval);
                        delete card.dataset.typeInterval;
                    }

                    card.classList.remove('expanded');
                    const d = card.querySelector('p');
                    d.textContent = '';
                    d.style.display = 'none';
                    card.setAttribute('aria-expanded', 'false');
                    const ind = card.querySelector('.more-indicator'); if (ind) ind.textContent = 'Read more';

                    // Add dimmed class back to all cards when collapsing (return to unfocused state)
                    cards.forEach(otherCard => {
                        otherCard.classList.add('dimmed');
                    });
                }
            });

            // keyboard activation (Enter / Space)
            card.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    card.click();
                }
            });
        });
    }

    initCards();

    updateIndicator();
    initScrollbar();
});
