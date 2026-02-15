// ===== Navigation Scroll Effect =====
const navbar = document.getElementById('navbar');
const navToggle = document.getElementById('navToggle');
const navLinks = document.querySelector('.nav-links');

window.addEventListener('scroll', () => {
    if (window.scrollY > 50) {
        navbar.classList.add('scrolled');
    } else {
        navbar.classList.remove('scrolled');
    }
});

// Mobile Nav Toggle
navToggle.addEventListener('click', () => {
    navLinks.classList.toggle('active');
    navToggle.classList.toggle('active');
});

// Close mobile nav when clicking a link
navLinks.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
        navLinks.classList.remove('active');
        navToggle.classList.remove('active');
    });
});

// ===== Animated Stats Counter =====
const statNumbers = document.querySelectorAll('.stat-number');
const statFills = document.querySelectorAll('.stat-fill');

const animateStats = (entries, observer) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            // Animate numbers
            statNumbers.forEach(stat => {
                const target = parseInt(stat.dataset.target);
                const duration = 2000;
                const increment = target / (duration / 16);
                let current = 0;

                const updateCount = () => {
                    current += increment;
                    if (current < target) {
                        stat.textContent = Math.floor(current);
                        requestAnimationFrame(updateCount);
                    } else {
                        stat.textContent = target;
                    }
                };

                updateCount();
            });

            // Animate bars
            statFills.forEach(fill => {
                fill.classList.add('animate');
            });

            observer.unobserve(entry.target);
        }
    });
};

const statsObserver = new IntersectionObserver(animateStats, {
    threshold: 0.3
});

const statsSection = document.querySelector('.stats');
if (statsSection) {
    statsObserver.observe(statsSection);
}

// ===== Scroll Reveal Animation =====
const revealElements = document.querySelectorAll('.timeline-item, .info-card, .gallery-item, .achievement-badge');

const revealOnScroll = (entries, observer) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('animate-in');
            observer.unobserve(entry.target);
        }
    });
};

const revealObserver = new IntersectionObserver(revealOnScroll, {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
});

revealElements.forEach(el => {
    el.style.opacity = '0';
    revealObserver.observe(el);
});

// ===== Smooth Scroll for Navigation =====
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            const headerOffset = 80;
            const elementPosition = target.getBoundingClientRect().top;
            const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

            window.scrollTo({
                top: offsetPosition,
                behavior: 'smooth'
            });
        }
    });
});

// ===== Hero Image Fallback =====
const heroImage = document.getElementById('heroImage');
if (heroImage) {
    heroImage.onerror = function () {
        // If custom image fails, set a placeholder style
        this.parentElement.style.background = 'linear-gradient(135deg, #C8102E, #FFD700)';
        this.style.display = 'none';
    };
}

// ===== Gallery Lightbox (Simple) =====
const galleryItems = document.querySelectorAll('.gallery-item');
galleryItems.forEach(item => {
    item.addEventListener('click', () => {
        const img = item.querySelector('img');
        if (img) {
            // Simple overlay effect
            const overlay = document.createElement('div');
            overlay.style.cssText = `
                position: fixed;
                inset: 0;
                background: rgba(0,0,0,0.95);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 9999;
                cursor: pointer;
                padding: 40px;
            `;

            const enlargedImg = document.createElement('img');
            enlargedImg.src = img.src;
            enlargedImg.style.cssText = `
                max-width: 90%;
                max-height: 90vh;
                object-fit: contain;
                border-radius: 8px;
                box-shadow: 0 20px 60px rgba(0,0,0,0.5);
            `;

            overlay.appendChild(enlargedImg);
            document.body.appendChild(overlay);
            document.body.style.overflow = 'hidden';

            overlay.addEventListener('click', () => {
                overlay.remove();
                document.body.style.overflow = '';
            });
        }
    });
});

// ===== Parallax Effect for Hero =====
window.addEventListener('scroll', () => {
    const hero = document.querySelector('.hero');
    if (hero) {
        const scrolled = window.pageYOffset;
        hero.style.backgroundPositionY = scrolled * 0.5 + 'px';
    }
});

console.log('🏉 Teboho Modipa Portfolio - Ready to roar!');
