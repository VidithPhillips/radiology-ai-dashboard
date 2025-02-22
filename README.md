# Radiology AI Research Dashboard

A real-time dashboard that aggregates and visualizes AI research trends in Radiology from PubMed. View the live dashboard at [https://vidithphillips.github.io/radiology-ai-dashboard/](https://vidithphillips.github.io/radiology-ai-dashboard/)

## Features

- **Real-time Article Aggregation**: Fetches latest AI in Radiology research papers using PubMed's official MeSH terms
- **Subdomain Classification**: Automatically categorizes articles into radiology subspecialties:
  - Neuroradiology
  - Chest/Cardiac
  - Abdominal
  - Musculoskeletal
  - Breast
  - Nuclear/Molecular
  - General/Other

- **Interactive Visualization**: 
  - Pie chart showing distribution of research across radiology subdomains
  - Filterable article list with pagination
  - Search functionality across all articles

- **Auto-refresh**: Updates daily to ensure latest research is always available

## Technical Details

### Data Source
- Uses PubMed's E-utilities API
- Implements proper MeSH term queries for accurate article retrieval:
  - Artificial Intelligence [Mesh]
  - Deep Learning [Mesh]
  - Machine Learning [Mesh]
  - Radiology [Mesh]
  - Diagnostic Imaging [Mesh]

### Built With
- React 18
- Chart.js for visualizations
- Axios for API requests
- Dark theme UI with responsive design

## Local Development

```bash
# Clone the repository
git clone https://github.com/VidithPhillips/radiology-ai-dashboard.git

# Install dependencies
cd radiology-ai-dashboard
npm install

# Start development server
npm start
```

## Deployment

The dashboard is automatically deployed to GitHub Pages when changes are pushed to the main branch.

```bash
# Manual deployment
npm run deploy
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - feel free to use this project for your own research or modifications.

## Author

Vidith Phillips - [GitHub Profile](https://github.com/VidithPhillips)
